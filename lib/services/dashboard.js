import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { notifyPermission } from "@/lib/services/notifications";
import { notFound, invalidState, conflict } from "@/lib/errors";
import { D, toMoneyString } from "@/lib/utils/money";
import { addDays, dayRangeUtc, weekdayOf, minutesFromHHMM, hhmmFromMinutes, zonedToUtc, todayInTz } from "@/lib/utils/time";

// ───────────────────────────── Period helpers (pure) ─────────────────────────────
// A period is a run of whole local days [from, to] (inclusive) in the hospital time zone.
// Its UTC bounds are [start of `from`, start of the day after `to`). The comparison period is
// the same number of days immediately before it.

export const RANGE_PRESETS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
];
export const DEFAULT_RANGE = "7d";
export const MAX_RANGE_DAYS = 366;

export function isDateString(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whole days from a to b (b − a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function dayList(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length <= MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" });
const dayYearFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
export const formatDayLabel = (s) => dayFmt.format(new Date(`${s}T00:00:00Z`));
export function formatRangeLabel(from, to) {
  if (from === to) return dayYearFmt.format(new Date(`${from}T00:00:00Z`));
  return `${dayFmt.format(new Date(`${from}T00:00:00Z`))} – ${dayYearFmt.format(new Date(`${to}T00:00:00Z`))}`;
}

function buildPeriod(key, from, to) {
  const days = daysBetween(from, to) + 1;
  const prev = { from: addDays(from, -days), to: addDays(from, -1) };
  const preset = RANGE_PRESETS.find((p) => p.key === key);
  return { key, from, to, days, prev, label: preset ? preset.label : "Custom range", rangeLabel: formatRangeLabel(from, to), prevLabel: formatRangeLabel(prev.from, prev.to) };
}

/**
 * Resolve URL params { range, from, to } into a period ending today (presets) or the
 * given inclusive custom dates. Invalid input falls back to the default preset.
 */
export function resolvePeriod(params = {}, today) {
  const { range, from, to } = params || {};
  if (range === "custom" && isDateString(from) && isDateString(to) && from <= to && daysBetween(from, to) < MAX_RANGE_DAYS) {
    return buildPeriod("custom", from, to);
  }
  const preset = RANGE_PRESETS.find((p) => p.key === range) ?? RANGE_PRESETS.find((p) => p.key === DEFAULT_RANGE);
  return buildPeriod(preset.key, addDays(today, -(preset.days - 1)), today);
}

/** UTC instants for a period and its comparison period: [start, end) and [prevStart, prevEnd). */
export function periodBounds(period, tz) {
  return {
    start: dayRangeUtc(period.from, tz)[0],
    end: dayRangeUtc(period.to, tz)[1],
    prevStart: dayRangeUtc(period.prev.from, tz)[0],
    prevEnd: dayRangeUtc(period.prev.to, tz)[1],
  };
}

/** Trend between two values; pct is null when the previous value is 0 and the current is not ("new"). */
export function computeTrend(current, previous) {
  const cur = Number(current), prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const pct = prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  return { current: cur, previous: prev, pct, direction: cur > prev ? "up" : cur < prev ? "down" : "flat" };
}

/** Turn sparse per-day rows into a dense series covering every day of the period. */
export function fillDaily(days, byDay, keys) {
  return days.map((d) => {
    const r = byDay.get(d) || {};
    const o = { date: d, label: formatDayLabel(d) };
    for (const k of keys) o[k] = r[k] ?? 0;
    return o;
  });
}

/**
 * Remaining bookable slots for one doctor on one local date, from their availability windows
 * minus booked (non-cancelled) appointments, schedule exceptions and slots already in the past.
 */
export function computeFreeSlots({ windows, slotMinutes, date, tz, booked = [], exceptions = [], now = new Date() }) {
  let total = 0, free = 0;
  const step = Math.max(5, Number(slotMinutes) || 15);
  for (const w of windows) {
    const endMin = minutesFromHHMM(w.endTime);
    for (let m = minutesFromHHMM(w.startTime); m + step <= endMin; m += step) {
      total++;
      const s = zonedToUtc(date, hhmmFromMinutes(m), tz);
      const e = new Date(s.getTime() + step * 60000);
      if (s < now) continue;
      const overlaps = (x) => new Date(x.startsAt) < e && new Date(x.endsAt) > s;
      if (booked.some(overlaps) || exceptions.some(overlaps)) continue;
      free++;
    }
  }
  return { total, free };
}

const has = (session, p) => (Array.isArray(p) ? p.some((x) => session.permissions.has(x)) : session.permissions.has(p));

// ───────────────────────────── Views (role sections) ─────────────────────────────

export const DASHBOARD_VIEWS = [
  { key: "overview", label: "Hospital overview", allowed: (s) => has(s, ["reports:read", "settings:manage"]) },
  { key: "doctor", label: "My clinic", allowed: (s) => !!s.doctorId },
  { key: "reception", label: "Front desk", allowed: (s) => has(s, "appointments:create") && !s.doctorId },
  { key: "nursing", label: "Nursing", allowed: (s) => has(s, "nursing:create") },
  { key: "laboratory", label: "Laboratory", allowed: (s) => has(s, "lab:process") },
  { key: "radiology", label: "Radiology", allowed: (s) => has(s, "radiology:report") },
  { key: "pharmacy", label: "Pharmacy", allowed: (s) => has(s, "pharmacy:dispense") },
  { key: "billing", label: "Billing", allowed: (s) => has(s, "billing:payment") },
];

export function availableViews(session) {
  return DASHBOARD_VIEWS.filter((v) => v.allowed(session)).map(({ key, label }) => ({ key, label }));
}

/** Administrators land on the overview; everyone else on their own work queue first. */
export function defaultView(session, views) {
  if (!views.length) return null;
  if (has(session, ["settings:manage", "users:manage"]) && views.some((v) => v.key === "overview")) return "overview";
  return (views.find((v) => v.key !== "overview") || views[0]).key;
}

export function buildContext(hospital, params, now = new Date()) {
  const tz = hospital.timezone;
  const today = todayInTz(tz);
  const period = resolvePeriod(params, today);
  const [todayStart, todayEnd] = dayRangeUtc(today, tz);
  return {
    tz, today, period, bounds: periodBounds(period, tz), todayStart, todayEnd, now,
    days: dayList(period.from, period.to), settings: hospital.settings, currency: hospital.currency, locale: hospital.locale,
  };
}

// ───────────────────────────── Shared queries ─────────────────────────────

export const LAB_PENDING = ["REQUESTED", "SAMPLE_COLLECTED", "PROCESSING", "AWAITING_VALIDATION"];
const OPEN_APPT = ["REQUESTED", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS"];
const ACTIVE_RX = ["ACTIVE", "PARTIALLY_DISPENSED"];

const staffName = (s) => (s ? `${s.firstName} ${s.lastName}` : "—");
const patientRef = { select: { id: true, mrn: true, firstName: true, lastName: true } };
const doctorRef = { select: { id: true, staff: { select: { firstName: true, lastName: true } } } };

/** Medicines whose physical on-hand quantity (sum of all batches) is at or below the reorder level. */
export async function lowStockMedicines(limit = 500) {
  return prisma.$queryRaw`
    SELECT m.id, m.code, m."genericName", m."brandName", m.strength, m."reorderLevel",
           COALESCE(SUM(b.quantity), 0)::int AS "onHand"
    FROM "Medication" m
    LEFT JOIN "MedicationBatch" b ON b."medicationId" = m.id
    WHERE m."isActive" = true
    GROUP BY m.id
    HAVING COALESCE(SUM(b.quantity), 0) <= m."reorderLevel"
    ORDER BY COALESCE(SUM(b.quantity), 0) ASC, m."genericName" ASC
    LIMIT ${limit}`;
}

export async function expiringBatches(today, days, take = 8) {
  const where = { quantity: { gt: 0 }, expiryDate: { gte: new Date(today), lte: new Date(addDays(today, days)) } };
  const [count, rows] = await Promise.all([
    prisma.medicationBatch.count({ where }),
    prisma.medicationBatch.findMany({ where, orderBy: { expiryDate: "asc" }, take, select: { id: true, batchNo: true, expiryDate: true, quantity: true, medication: { select: { genericName: true, strength: true } } } }),
  ]);
  return { count, rows };
}

export async function netCollected(start, end) {
  const [p, r] = await Promise.all([
    prisma.payment.aggregate({ where: { receivedAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.refund.aggregate({ where: { createdAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const payments = D(p._sum.amount), refunds = D(r._sum.amount);
  return { payments: toMoneyString(payments), refunds: toMoneyString(refunds), net: toMoneyString(payments.minus(refunds)), paymentCount: p._count._all, refundCount: r._count._all };
}

async function netCollectedDaily(ctx) {
  const { start, end } = ctx.bounds;
  const [pay, ref] = await Promise.all([
    prisma.$queryRaw`SELECT to_char(("receivedAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, SUM(amount) AS amount FROM "Payment" WHERE "receivedAt" >= ${start} AND "receivedAt" < ${end} GROUP BY 1`,
    prisma.$queryRaw`SELECT to_char(("createdAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, SUM(amount) AS amount FROM "Refund" WHERE "createdAt" >= ${start} AND "createdAt" < ${end} GROUP BY 1`,
  ]);
  const byDay = new Map();
  for (const r of pay) byDay.set(r.day, { net: D(r.amount) });
  for (const r of ref) byDay.set(r.day, { net: (byDay.get(r.day)?.net ?? D(0)).minus(D(r.amount)) });
  for (const [k, v] of byDay) byDay.set(k, { net: Number(v.net.toFixed(2)) });
  return fillDaily(ctx.days, byDay, ["net"]);
}

// ───────────────────────────── Hospital overview ─────────────────────────────

export async function loadOverview(session, ctx) {
  const { today, todayStart, todayEnd } = ctx;
  const { start, end, prevStart, prevEnd } = ctx.bounds;
  const fin = has(session, "reports:financial");
  const expiryDays = Number(ctx.settings.pharmacy?.expiryAlertDays ?? 90);
  const todayDate = new Date(today);
  const inPeriod = { gte: start, lt: end }, inPrev = { gte: prevStart, lt: prevEnd }, inToday = { gte: todayStart, lt: todayEnd };

  const [
    totalPatients, newPatients, newPatientsPrev, todayAppts, todayCompleted,
    completed, completedPrev, cancelled, cancelledPrev,
    currentAdmissions, bedGroups, staffOnDuty, doctorsToday,
    pendingLabOrders, pendingLabTests, statPending, lowStock, expiring, expiredWithStock, waitingTriage,
  ] = await Promise.all([
    prisma.patient.count({ where: { status: "ACTIVE" } }),
    prisma.patient.count({ where: { status: { not: "MERGED" }, registeredAt: inPeriod } }),
    prisma.patient.count({ where: { status: { not: "MERGED" }, registeredAt: inPrev } }),
    prisma.appointment.count({ where: { startsAt: inToday, status: { not: "CANCELLED" } } }),
    prisma.appointment.count({ where: { startsAt: inToday, status: "COMPLETED" } }),
    prisma.appointment.count({ where: { startsAt: inPeriod, status: "COMPLETED" } }),
    prisma.appointment.count({ where: { startsAt: inPrev, status: "COMPLETED" } }),
    prisma.appointment.count({ where: { startsAt: inPeriod, status: "CANCELLED" } }),
    prisma.appointment.count({ where: { startsAt: inPrev, status: "CANCELLED" } }),
    prisma.admission.count({ where: { status: "ADMITTED" } }),
    prisma.bed.groupBy({ by: ["status"], where: { ward: { isActive: true } }, _count: { _all: true } }),
    prisma.employeeAttendance.count({ where: { date: todayDate, status: { in: ["PRESENT", "LATE"] } } }),
    prisma.doctorProfile.count({ where: { acceptsAppointments: true, staff: { employmentStatus: "ACTIVE" }, availability: { some: { weekday: weekdayOf(today) } }, exceptions: { none: { startsAt: { lt: todayEnd }, endsAt: { gt: todayStart } } } } }),
    prisma.labOrder.count({ where: { status: { in: LAB_PENDING } } }),
    prisma.labOrderItem.count({ where: { order: { status: { in: LAB_PENDING } } } }),
    prisma.labOrder.count({ where: { status: { in: LAB_PENDING }, priority: "STAT" } }),
    lowStockMedicines(),
    prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { gte: todayDate, lte: new Date(addDays(today, expiryDays)) } } }),
    prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { lt: todayDate } } }),
    prisma.emergencyVisit.count({ where: { status: "WAITING_TRIAGE" } }),
  ]);

  const beds = Object.fromEntries(bedGroups.map((g) => [g.status, g._count._all]));
  let finance = null;
  if (fin) {
    const [outstanding, revenue, revenuePrev] = await Promise.all([
      prisma.invoice.aggregate({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, _count: { _all: true }, _sum: { balance: true } }),
      netCollected(start, end),
      netCollected(prevStart, prevEnd),
    ]);
    finance = { outstandingCount: outstanding._count._all, outstandingBalance: toMoneyString(D(outstanding._sum.balance)), revenue, revenuePrev };
  }

  // Charts
  const [apptDaily, regDaily, admDaily, disDaily, deptGroups, revenueDaily] = await Promise.all([
    prisma.$queryRaw`SELECT to_char(("startsAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, status::text AS status, count(*)::int AS n FROM "Appointment" WHERE "startsAt" >= ${start} AND "startsAt" < ${end} GROUP BY 1, 2`,
    prisma.$queryRaw`SELECT to_char(("registeredAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "Patient" WHERE status <> 'MERGED' AND "registeredAt" >= ${start} AND "registeredAt" < ${end} GROUP BY 1`,
    prisma.$queryRaw`SELECT to_char(("admittedAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "Admission" WHERE status <> 'CANCELLED' AND "admittedAt" >= ${start} AND "admittedAt" < ${end} GROUP BY 1`,
    prisma.$queryRaw`SELECT to_char(("dischargedAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "Admission" WHERE status = 'DISCHARGED' AND "dischargedAt" >= ${start} AND "dischargedAt" < ${end} GROUP BY 1`,
    prisma.appointment.groupBy({ by: ["departmentId"], where: { startsAt: inPeriod, status: { not: "CANCELLED" } }, _count: { _all: true } }),
    fin ? netCollectedDaily(ctx) : null,
  ]);

  const apptByDay = new Map();
  for (const r of apptDaily) {
    const o = apptByDay.get(r.day) || { completed: 0, open: 0, cancelled: 0 };
    if (r.status === "COMPLETED") o.completed += r.n;
    else if (r.status === "CANCELLED" || r.status === "NO_SHOW") o.cancelled += r.n;
    else o.open += r.n;
    apptByDay.set(r.day, o);
  }
  const regByDay = new Map(regDaily.map((r) => [r.day, { n: r.n }]));
  const adDis = new Map();
  for (const r of admDaily) adDis.set(r.day, { ...(adDis.get(r.day) || {}), admissions: r.n });
  for (const r of disDaily) adDis.set(r.day, { ...(adDis.get(r.day) || {}), discharges: r.n });
  const depts = await prisma.department.findMany({ where: { id: { in: deptGroups.map((g) => g.departmentId) } }, select: { id: true, name: true } });
  const deptName = new Map(depts.map((d) => [d.id, d.name]));

  const recentActivity = has(session, "audit:read")
    ? await prisma.auditLog.findMany({
      where: { NOT: [{ action: { endsWith: ".view" } }, { action: "document.download" }] },
      orderBy: { createdAt: "desc" }, take: 8,
      select: { id: true, action: true, entityType: true, createdAt: true, user: { select: { name: true } } },
    })
    : null;

  return {
    totalPatients, newPatients, newPatientsPrev, todayAppts, todayCompleted, completed, completedPrev, cancelled, cancelledPrev,
    currentAdmissions, beds, staffOnDuty, doctorsToday, pendingLabOrders, pendingLabTests, statPending,
    lowStockCount: lowStock.length, expiringCount: expiring, expiredWithStock, expiryDays, waitingTriage, finance,
    charts: {
      appointments: fillDaily(ctx.days, apptByDay, ["completed", "open", "cancelled"]),
      registrations: fillDaily(ctx.days, regByDay, ["n"]),
      admissions: fillDaily(ctx.days, adDis, ["admissions", "discharges"]),
      departments: deptGroups.map((g) => ({ label: deptName.get(g.departmentId) || "Unknown", n: g._count._all })).sort((a, b) => b.n - a.n),
      revenue: revenueDaily,
    },
    recentActivity,
  };
}

// ───────────────────────────── Doctor ─────────────────────────────

export async function loadDoctor(doctorId, ctx) {
  const { today, todayStart, todayEnd } = ctx;
  const { start, end, prevStart, prevEnd } = ctx.bounds;
  const weekEnd = dayRangeUtc(addDays(today, 7), ctx.tz)[1];
  const [
    schedule, waiting, upcoming, upcomingCount, underCare, pendingLabs, pendingLabCount,
    followUps, recent, consults, consultsPrev, staleDrafts, staleInProgress,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: { doctorId, startsAt: { gte: todayStart, lt: todayEnd }, status: { not: "CANCELLED" } }, orderBy: { startsAt: "asc" },
      select: { id: true, appointmentNo: true, startsAt: true, status: true, type: true, patient: patientRef, queueEntry: { select: { tokenNumber: true, status: true } } },
    }),
    prisma.queueEntry.count({ where: { queueDate: new Date(today), status: "WAITING", appointment: { doctorId } } }),
    prisma.appointment.findMany({
      where: { doctorId, startsAt: { gte: todayEnd, lt: weekEnd }, status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] } }, orderBy: { startsAt: "asc" }, take: 6,
      select: { id: true, appointmentNo: true, startsAt: true, status: true, patient: patientRef },
    }),
    prisma.appointment.count({ where: { doctorId, startsAt: { gte: todayEnd, lt: weekEnd }, status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] } } }),
    prisma.admission.findMany({
      where: { doctorId, status: "ADMITTED" }, orderBy: { admittedAt: "asc" },
      select: { id: true, admissionNo: true, admittedAt: true, patient: patientRef, bedAssignments: { where: { endedAt: null }, take: 1, select: { bed: { select: { label: true, ward: { select: { name: true } } } } } } },
    }),
    prisma.labOrder.findMany({
      where: { doctorId, status: { in: LAB_PENDING } }, orderBy: { createdAt: "asc" }, take: 6,
      select: { id: true, orderNo: true, status: true, priority: true, createdAt: true, patient: patientRef, _count: { select: { items: true } } },
    }),
    prisma.labOrder.count({ where: { doctorId, status: { in: LAB_PENDING } } }),
    prisma.encounter.findMany({
      where: { doctorId, status: "FINALIZED", followUpDate: { gte: new Date(today), lte: new Date(addDays(today, 7)) } }, orderBy: { followUpDate: "asc" }, take: 8,
      select: { id: true, encounterNo: true, followUpDate: true, patient: patientRef },
    }),
    prisma.encounter.findMany({
      where: { doctorId, status: "FINALIZED" }, orderBy: { finalizedAt: "desc" }, take: 6,
      select: { id: true, encounterNo: true, finalizedAt: true, patient: patientRef, diagnoses: { where: { isPrimary: true }, take: 1, select: { code: true, description: true } } },
    }),
    prisma.encounter.count({ where: { doctorId, status: "FINALIZED", finalizedAt: { gte: start, lt: end } } }),
    prisma.encounter.count({ where: { doctorId, status: "FINALIZED", finalizedAt: { gte: prevStart, lt: prevEnd } } }),
    prisma.encounter.findMany({
      where: { doctorId, status: "DRAFT", startedAt: { lt: todayStart } }, orderBy: { startedAt: "asc" }, take: 10,
      select: { id: true, encounterNo: true, startedAt: true, patient: patientRef },
    }),
    prisma.appointment.findMany({
      where: { doctorId, status: "IN_PROGRESS", startsAt: { lt: todayStart } }, orderBy: { startsAt: "asc" }, take: 10,
      select: { id: true, appointmentNo: true, startsAt: true, patient: patientRef },
    }),
  ]);
  return { schedule, waiting, upcoming, upcomingCount, underCare, pendingLabs, pendingLabCount, followUps, recent, consults, consultsPrev, staleDrafts, staleInProgress };
}

// ───────────────────────────── Front desk ─────────────────────────────

export async function loadReception(ctx) {
  const { today, todayStart, todayEnd, now } = ctx;
  const { start, end, prevStart, prevEnd } = ctx.bounds;
  const inToday = { gte: todayStart, lt: todayEnd };
  const [byStatus, walkIns, checkIns, queue, waitingCount, requests, booked, bookedPrev, registered, registeredPrev, doctors] = await Promise.all([
    prisma.appointment.groupBy({ by: ["status"], where: { startsAt: inToday }, _count: { _all: true } }),
    prisma.appointment.count({ where: { startsAt: inToday, type: "WALK_IN", status: { not: "CANCELLED" } } }),
    prisma.appointment.count({ where: { checkedInAt: inToday } }),
    prisma.queueEntry.findMany({
      where: { queueDate: new Date(today), status: { in: ["WAITING", "CALLED"] } }, orderBy: { tokenNumber: "asc" }, take: 12,
      select: { id: true, tokenNumber: true, status: true, appointment: { select: { id: true, startsAt: true, patient: patientRef, doctor: doctorRef } } },
    }),
    prisma.queueEntry.count({ where: { queueDate: new Date(today), status: "WAITING" } }),
    prisma.appointment.count({ where: { status: "REQUESTED", startsAt: { gte: todayStart } } }),
    prisma.appointment.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.appointment.count({ where: { createdAt: { gte: prevStart, lt: prevEnd } } }),
    prisma.patient.count({ where: { status: { not: "MERGED" }, registeredAt: { gte: start, lt: end } } }),
    prisma.patient.count({ where: { status: { not: "MERGED" }, registeredAt: { gte: prevStart, lt: prevEnd } } }),
    prisma.doctorProfile.findMany({
      where: { acceptsAppointments: true, staff: { employmentStatus: "ACTIVE" }, availability: { some: { weekday: weekdayOf(today) } } },
      select: {
        id: true, slotMinutes: true, specialty: true, staff: { select: { firstName: true, lastName: true } }, department: { select: { name: true } },
        availability: { where: { weekday: weekdayOf(today) }, orderBy: { startTime: "asc" }, select: { startTime: true, endTime: true } },
        exceptions: { where: { startsAt: { lt: todayEnd }, endsAt: { gt: todayStart } }, select: { startsAt: true, endsAt: true, reason: true } },
        appointments: { where: { startsAt: { lt: todayEnd }, endsAt: { gt: todayStart }, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, select: { startsAt: true, endsAt: true } },
      },
    }),
  ]);
  const availability = doctors.map((d) => {
    const slots = computeFreeSlots({ windows: d.availability, slotMinutes: d.slotMinutes, date: today, tz: ctx.tz, booked: d.appointments, exceptions: d.exceptions, now });
    return {
      id: d.id, name: `Dr. ${staffName(d.staff)}`, department: d.department.name, specialty: d.specialty,
      windows: d.availability.map((w) => `${w.startTime}–${w.endTime}`).join(", "), booked: d.appointments.length,
      hasException: d.exceptions.length > 0, ...slots,
    };
  }).sort((a, b) => b.free - a.free);
  return {
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])), walkIns, checkIns, queue, waitingCount, requests,
    booked, bookedPrev, registered, registeredPrev, availability,
  };
}

// ───────────────────────────── Nursing ─────────────────────────────

export async function loadNursing(session, ctx) {
  const { todayStart, todayEnd, now } = ctx;
  const inToday = { gte: todayStart, lt: todayEnd };
  const since = new Date(now.getTime() - 8 * 3600 * 1000);
  const [wards, vitalsToday, vitalsMine, medsToday, dueObs, dueObsCount, waitingTriage] = await Promise.all([
    prisma.ward.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, beds: { select: { status: true } } } }),
    prisma.vitalSign.count({ where: { recordedAt: inToday } }),
    prisma.vitalSign.count({ where: { recordedAt: inToday, recordedById: session.user.id } }),
    prisma.medicationAdministration.count({ where: { administeredAt: inToday } }),
    prisma.admission.findMany({
      where: { status: "ADMITTED", vitals: { none: { recordedAt: { gte: since } } } }, orderBy: { admittedAt: "asc" }, take: 10,
      select: { id: true, admissionNo: true, patient: patientRef, bedAssignments: { where: { endedAt: null }, take: 1, select: { bed: { select: { label: true, ward: { select: { name: true } } } } } } },
    }),
    prisma.admission.count({ where: { status: "ADMITTED", vitals: { none: { recordedAt: { gte: since } } } } }),
    has(session, "emergency:read") ? prisma.emergencyVisit.count({ where: { status: "WAITING_TRIAGE" } }) : null,
  ]);
  const wardRows = wards.map((w) => {
    const c = (s) => w.beds.filter((b) => b.status === s).length;
    return { id: w.id, name: w.name, type: w.type, total: w.beds.length, occupied: c("OCCUPIED"), available: c("AVAILABLE"), cleaning: c("CLEANING"), outOfService: c("OUT_OF_SERVICE") };
  });
  return { wards: wardRows, admitted: wardRows.reduce((s, w) => s + w.occupied, 0), vitalsToday, vitalsMine, medsToday, dueObs, dueObsCount, waitingTriage };
}

// ───────────────────────────── Laboratory ─────────────────────────────

export async function loadLaboratory(ctx) {
  const { start, end, prevStart, prevEnd } = ctx.bounds;
  const [byStatus, urgent, released, releasedPrev, tat, rejected, pendingForOverdue] = await Promise.all([
    prisma.labOrder.groupBy({ by: ["status"], where: { status: { in: LAB_PENDING } }, _count: { _all: true } }),
    prisma.labOrder.findMany({
      where: { status: { in: LAB_PENDING }, priority: { in: ["STAT", "URGENT"] } }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 8,
      select: { id: true, orderNo: true, status: true, priority: true, createdAt: true, patient: patientRef, _count: { select: { items: true } } },
    }),
    prisma.labOrder.count({ where: { status: "RELEASED", releasedAt: { gte: start, lt: end } } }),
    prisma.labOrder.count({ where: { status: "RELEASED", releasedAt: { gte: prevStart, lt: prevEnd } } }),
    prisma.$queryRaw`SELECT AVG(EXTRACT(EPOCH FROM ("releasedAt" - "createdAt")) / 3600.0) AS avg FROM "LabOrder" WHERE status = 'RELEASED' AND "releasedAt" >= ${start} AND "releasedAt" < ${end}`,
    prisma.specimen.count({ where: { status: "REJECTED", collectedAt: { gte: start, lt: end } } }),
    prisma.labOrder.findMany({ where: { status: { in: LAB_PENDING } }, take: 1000, select: { createdAt: true, items: { select: { test: { select: { turnaroundHours: true } } } } } }),
  ]);
  const now = ctx.now.getTime();
  const overdue = pendingForOverdue.filter((o) => {
    const tatH = Math.max(0, ...o.items.map((i) => i.test.turnaroundHours));
    return o.createdAt.getTime() + tatH * 3600000 < now;
  }).length;
  const avg = tat[0]?.avg;
  return {
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])), urgent, released, releasedPrev,
    avgTatHours: avg == null ? null : Number(D(avg).toFixed(1)), rejected, overdue,
  };
}

// ───────────────────────────── Radiology ─────────────────────────────

export async function loadRadiology(ctx) {
  const { start, end, prevStart, prevEnd } = ctx.bounds;
  const [byStatus, verified, verifiedPrev, queue] = await Promise.all([
    prisma.imagingStudy.groupBy({ by: ["status"], where: { status: { in: ["REQUESTED", "SCHEDULED", "IN_PROGRESS", "REPORTED"] } }, _count: { _all: true } }),
    prisma.imagingReport.count({ where: { verifiedAt: { gte: start, lt: end } } }),
    prisma.imagingReport.count({ where: { verifiedAt: { gte: prevStart, lt: prevEnd } } }),
    prisma.imagingStudy.findMany({
      where: { status: { in: ["REQUESTED", "SCHEDULED", "IN_PROGRESS", "REPORTED"] } }, orderBy: { createdAt: "asc" }, take: 8,
      select: { id: true, studyNo: true, modality: true, bodyPart: true, status: true, scheduledAt: true, createdAt: true, patient: patientRef },
    }),
  ]);
  return { byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])), verified, verifiedPrev, queue };
}

// ───────────────────────────── Pharmacy ─────────────────────────────

export async function loadPharmacy(ctx) {
  const { today } = ctx;
  const { start, end, prevStart, prevEnd } = ctx.bounds;
  const expiryDays = Number(ctx.settings.pharmacy?.expiryAlertDays ?? 90);
  const [pendingCount, pending, dispensed, dispensedPrev, value, lowStock, expiring, expired] = await Promise.all([
    prisma.prescription.count({ where: { status: { in: ACTIVE_RX } } }),
    prisma.prescription.findMany({
      where: { status: { in: ACTIVE_RX } }, orderBy: { issuedAt: "asc" }, take: 8,
      select: { id: true, prescriptionNo: true, status: true, issuedAt: true, createdAt: true, patient: patientRef, _count: { select: { items: true } } },
    }),
    prisma.stockMovement.aggregate({ where: { type: "DISPENSE", createdAt: { gte: start, lt: end } }, _sum: { quantity: true }, _count: { _all: true } }),
    prisma.stockMovement.aggregate({ where: { type: "DISPENSE", createdAt: { gte: prevStart, lt: prevEnd } }, _sum: { quantity: true }, _count: { _all: true } }),
    prisma.$queryRaw`SELECT COALESCE(SUM(-sm.quantity * m."sellingPrice"), 0) AS value FROM "StockMovement" sm JOIN "Medication" m ON m.id = sm."medicationId" WHERE sm.type = 'DISPENSE' AND sm."createdAt" >= ${start} AND sm."createdAt" < ${end}`,
    lowStockMedicines(),
    expiringBatches(today, expiryDays),
    prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { lt: new Date(today) } } }),
  ]);
  return {
    pendingCount, pending,
    dispensedUnits: Math.abs(dispensed._sum.quantity ?? 0), dispensedUnitsPrev: Math.abs(dispensedPrev._sum.quantity ?? 0),
    dispenseCount: dispensed._count._all, dispenseCountPrev: dispensedPrev._count._all,
    dispensedValue: toMoneyString(D(value[0]?.value)), lowStock, expiring, expired, expiryDays,
  };
}

// ───────────────────────────── Billing ─────────────────────────────

export async function loadBilling(ctx) {
  const { todayStart, todayEnd } = ctx;
  const { start, end, prevStart, prevEnd } = ctx.bounds;
  const [today, period, prev, byMethod, outstanding, drafts, recent, daily] = await Promise.all([
    netCollected(todayStart, todayEnd),
    netCollected(start, end),
    netCollected(prevStart, prevEnd),
    prisma.payment.groupBy({ by: ["method"], where: { receivedAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, _count: { _all: true }, _sum: { balance: true } }),
    prisma.invoice.count({ where: { status: "DRAFT" } }),
    prisma.payment.findMany({
      orderBy: { receivedAt: "desc" }, take: 8,
      select: { id: true, receiptNo: true, amount: true, method: true, receivedAt: true, invoice: { select: { id: true, invoiceNo: true, patient: patientRef } } },
    }),
    netCollectedDaily(ctx),
  ]);
  return {
    today, period, prev, drafts, recent, daily,
    byMethod: byMethod.map((m) => ({ method: m.method, amount: toMoneyString(D(m._sum.amount)), count: m._count._all })).sort((a, b) => Number(b.amount) - Number(a.amount)),
    outstandingCount: outstanding._count._all, outstandingBalance: toMoneyString(D(outstanding._sum.balance)),
  };
}

// ───────────────────────────── Patient portal ─────────────────────────────
// Every query below is scoped by the signed-in patient's own id (session.patientId).
// Callers never pass a patient id that came from the client.

const PORTAL_UPCOMING = ["REQUESTED", "SCHEDULED", "CONFIRMED", "CHECKED_IN"];
const apptSelect = {
  id: true, appointmentNo: true, startsAt: true, endsAt: true, status: true, type: true, reason: true, cancelReason: true,
  doctor: { select: { id: true, specialty: true, staff: { select: { firstName: true, lastName: true } } } }, department: { select: { name: true } },
};

export async function portalOverview(patientId, userId) {
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 30 * 86400000);
  const [upcoming, visits, prescriptions, results, invoices, notifications, patient] = await Promise.all([
    prisma.appointment.findMany({ where: { patientId, status: { in: PORTAL_UPCOMING }, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 5, select: apptSelect }),
    prisma.encounter.findMany({
      where: { patientId, status: "FINALIZED" }, orderBy: { startedAt: "desc" }, take: 5,
      select: { id: true, encounterNo: true, startedAt: true, type: true, doctor: { select: { staff: { select: { firstName: true, lastName: true } } } }, department: { select: { name: true } }, diagnoses: { select: { code: true, description: true, isPrimary: true } } },
    }),
    prisma.prescription.findMany({
      where: { patientId, status: { in: ACTIVE_RX } }, orderBy: { issuedAt: "desc" }, take: 5,
      select: { id: true, prescriptionNo: true, issuedAt: true, status: true, items: { select: { id: true, dose: true, frequency: true, durationDays: true, medication: { select: { genericName: true, strength: true } } } } },
    }),
    prisma.labOrder.findMany({ where: { patientId, status: "RELEASED", releasedAt: { gte: recentCutoff } }, orderBy: { releasedAt: "desc" }, take: 5, select: { id: true, orderNo: true, releasedAt: true, items: { select: { test: { select: { name: true } } } } } }),
    prisma.invoice.findMany({ where: { patientId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, orderBy: { issuedAt: "desc" }, take: 5, select: { id: true, invoiceNo: true, issuedAt: true, total: true, balance: true, status: true } }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.patient.findUnique({ where: { id: patientId }, select: { id: true, mrn: true, firstName: true, lastName: true } }),
  ]);
  const outstanding = invoices.reduce((s, i) => s.plus(D(i.balance)), D(0));
  return { patient, upcoming, visits, prescriptions, results, invoices, outstanding: toMoneyString(outstanding), notifications };
}

export async function portalAppointments(patientId) {
  const now = new Date();
  const [upcoming, past] = await Promise.all([
    prisma.appointment.findMany({ where: { patientId, startsAt: { gte: now }, status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] } }, orderBy: { startsAt: "asc" }, take: 50, select: apptSelect }),
    prisma.appointment.findMany({ where: { patientId, OR: [{ startsAt: { lt: now } }, { status: { in: ["CANCELLED", "NO_SHOW", "COMPLETED"] } }] }, orderBy: { startsAt: "desc" }, take: 100, select: apptSelect }),
  ]);
  return { upcoming, past };
}

export async function listBookableDoctors() {
  const rows = await prisma.doctorProfile.findMany({
    where: { acceptsAppointments: true, staff: { employmentStatus: "ACTIVE" }, availability: { some: {} }, department: { isActive: true } },
    orderBy: [{ department: { name: "asc" } }, { staff: { lastName: "asc" } }],
    select: { id: true, specialty: true, consultationFee: true, staff: { select: { firstName: true, lastName: true } }, department: { select: { name: true } }, availability: { select: { weekday: true } } },
  });
  return rows.map((d) => ({ id: d.id, name: `Dr. ${staffName(d.staff)}`, specialty: d.specialty, department: d.department.name, fee: d.consultationFee.toString(), weekdays: [...new Set(d.availability.map((a) => a.weekday))].sort() }));
}

export async function portalPrescriptions(patientId) {
  return prisma.prescription.findMany({
    where: { patientId, status: { not: "DRAFT" } }, orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }], take: 100,
    select: {
      id: true, prescriptionNo: true, status: true, issuedAt: true, createdAt: true, notes: true,
      doctor: { select: { staff: { select: { firstName: true, lastName: true } } } },
      items: { select: { id: true, dose: true, route: true, frequency: true, durationDays: true, quantity: true, dispensedQty: true, instructions: true, medication: { select: { genericName: true, brandName: true, strength: true, dosageForm: true } } } },
    },
  });
}

export async function portalResults(patientId) {
  const [labs, imaging] = await Promise.all([
    prisma.labOrder.findMany({
      where: { patientId, status: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 100,
      select: {
        id: true, orderNo: true, releasedAt: true, createdAt: true, doctor: { select: { staff: { select: { firstName: true, lastName: true } } } },
        items: { select: { id: true, test: { select: { name: true, unit: true } }, results: { where: { isCurrent: true }, select: { value: true, unit: true, referenceRange: true, flag: true, comment: true } } } },
      },
    }),
    prisma.imagingStudy.findMany({
      where: { patientId, status: "VERIFIED", report: { isNot: null } }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, studyNo: true, modality: true, bodyPart: true, createdAt: true, report: { select: { findings: true, impression: true, verifiedAt: true } } },
    }),
  ]);
  return { labs, imaging };
}

export async function portalBilling(patientId) {
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { patientId, status: { not: "DRAFT" } }, orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }], take: 100,
      select: {
        id: true, invoiceNo: true, status: true, issuedAt: true, createdAt: true, subtotal: true, discountTotal: true, taxTotal: true, total: true, amountPaid: true, amountRefunded: true, balance: true,
        items: { select: { id: true, category: true, description: true, quantity: true, unitPrice: true, discount: true, lineTotal: true } },
      },
    }),
    prisma.payment.findMany({ where: { invoice: { patientId, status: { not: "DRAFT" } } }, orderBy: { receivedAt: "desc" }, take: 100, select: { id: true, receiptNo: true, amount: true, method: true, receivedAt: true, invoice: { select: { invoiceNo: true } } } }),
  ]);
  const outstanding = invoices.filter((i) => ["ISSUED", "PARTIALLY_PAID"].includes(i.status)).reduce((s, i) => s.plus(D(i.balance)), D(0));
  return { invoices, payments, outstanding: toMoneyString(outstanding) };
}

export async function portalDocuments(patientId) {
  return prisma.uploadedDocument.findMany({ where: { patientId }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, originalName: true, category: true, mimeType: true, sizeBytes: true, createdAt: true } });
}

export async function portalProfile(patientId) {
  return prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true, phone: true, email: true, address: true, city: true, consentToSms: true, consentToEmail: true, registeredAt: true },
  });
}

export async function updatePortalProfile(input, session, ip) {
  const patientId = session.patientId;
  const existing = await portalProfile(patientId);
  if (!existing) throw notFound();
  const data = {
    phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, address: input.address ?? null, city: input.city ?? null,
    consentToSms: !!input.consentToSms, consentToEmail: !!input.consentToEmail,
  };
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  if (!changed.length) return existing;
  await prisma.$transaction(async (tx) => {
    await tx.patient.update({ where: { id: patientId }, data });
    await audit({ userId: session.user.id, action: "portal.profile_update", entityType: "Patient", entityId: patientId, metadata: { fields: changed }, ipAddress: ip }, tx);
  });
  return portalProfile(patientId);
}

export const MAX_OPEN_REQUESTS = 3;
export const MAX_REQUEST_DAYS_AHEAD = 90;

/**
 * Patient requests an appointment. Creates status REQUESTED with a placeholder time (the doctor's
 * first availability window start on the preferred date); staff confirm the actual time.
 */
export async function requestPortalAppointment(input, settings, tz, session, ip) {
  if (!settings.allowPatientRequests) throw invalidState("Online appointment requests are currently turned off. Please call the hospital to book.");
  const patientId = session.patientId;
  const today = todayInTz(tz);
  const date = input.preferredDate;
  if (!isDateString(date)) throw invalidState("Choose a valid date.");
  if (date <= today) throw invalidState("Choose a date from tomorrow onwards.");
  if (daysBetween(today, date) > MAX_REQUEST_DAYS_AHEAD) throw invalidState(`Requests can be made up to ${MAX_REQUEST_DAYS_AHEAD} days ahead.`);

  const doctor = await prisma.doctorProfile.findFirst({
    where: { id: input.doctorId, acceptsAppointments: true, staff: { employmentStatus: "ACTIVE" } },
    select: { id: true, departmentId: true, consultationFee: true, slotMinutes: true, staff: { select: { firstName: true, lastName: true } }, availability: { where: { weekday: weekdayOf(date) }, orderBy: { startTime: "asc" }, select: { startTime: true } } },
  });
  if (!doctor) throw notFound("Doctor not found or not accepting appointments.");
  if (!doctor.availability.length) throw invalidState(`Dr. ${staffName(doctor.staff)} does not hold a clinic on that day of the week. Please choose another date.`);

  const startsAt = zonedToUtc(date, doctor.availability[0].startTime, tz);
  const endsAt = new Date(startsAt.getTime() + Math.max(5, doctor.slotMinutes) * 60000);
  const [dayStart, dayEnd] = dayRangeUtc(date, tz);

  return prisma.$transaction(async (tx) => {
    const [openRequests, sameDay] = await Promise.all([
      tx.appointment.count({ where: { patientId, status: "REQUESTED", startsAt: { gte: new Date() } } }),
      tx.appointment.count({ where: { patientId, doctorId: doctor.id, startsAt: { gte: dayStart, lt: dayEnd }, status: { in: OPEN_APPT } } }),
    ]);
    if (sameDay) throw conflict("You already have an appointment or request with this doctor on that date.");
    if (openRequests >= MAX_OPEN_REQUESTS) throw invalidState(`You already have ${openRequests} pending requests. Please wait for the hospital to confirm them.`);
    const appt = await tx.appointment.create({
      data: {
        appointmentNo: await newId(tx, "appointment"), patientId, doctorId: doctor.id, departmentId: doctor.departmentId,
        startsAt, endsAt, type: "NEW", status: "REQUESTED", reason: input.reason, fee: doctor.consultationFee, createdById: session.user.id,
      },
      select: apptSelect,
    });
    await audit({ userId: session.user.id, action: "portal.appointment_request", entityType: "Appointment", entityId: appt.id, metadata: { doctorId: doctor.id, preferredDate: date }, ipAddress: ip }, tx);
    // Scheduling staff (front desk / administrators) hold appointments:cancel. No patient details in the body.
    await notifyPermission(["appointments:cancel"], { category: "APPOINTMENT", title: "New appointment request", body: `Portal request ${appt.appointmentNo} needs a confirmed time.`, link: "/appointments?status=REQUESTED" }, tx);
    return appt;
  });
}

export const PORTAL_CANCELLABLE = ["REQUESTED", "SCHEDULED", "CONFIRMED"];

/** Pure rule: may a patient cancel this appointment now? Returns an error message or null. */
export function portalCancelBlocker(appt, minCancelHours, now = new Date()) {
  if (!PORTAL_CANCELLABLE.includes(appt.status)) return "This appointment can no longer be cancelled online.";
  const start = new Date(appt.startsAt).getTime();
  if (start <= now.getTime()) return "This appointment has already started or passed.";
  if (appt.status !== "REQUESTED" && start - now.getTime() < minCancelHours * 3600000) {
    return `Appointments can be cancelled online up to ${minCancelHours} hours before the start time. Please call the hospital.`;
  }
  return null;
}

export async function cancelPortalAppointment(id, reason, settings, session, ip) {
  const patientId = session.patientId;
  const appt = await prisma.appointment.findFirst({ where: { id, patientId }, select: { id: true, status: true, startsAt: true } });
  if (!appt) throw notFound();
  const blocker = portalCancelBlocker(appt, Number(settings.minCancelHours ?? 0));
  if (blocker) throw invalidState(blocker);
  return prisma.$transaction(async (tx) => {
    const r = await tx.appointment.updateMany({ where: { id, patientId, status: appt.status }, data: { status: "CANCELLED", cancelReason: reason } });
    if (!r.count) throw conflict("The appointment was changed by the hospital. Refresh and try again.");
    await audit({ userId: session.user.id, action: "portal.appointment_cancel", entityType: "Appointment", entityId: id, metadata: { fromStatus: appt.status }, ipAddress: ip }, tx);
    return { id, status: "CANCELLED" };
  });
}

