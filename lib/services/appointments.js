import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { ApiError, conflict, forbidden, invalidState, notFound } from "@/lib/errors";
import { can } from "@/lib/auth/session";
import { pageMeta } from "@/lib/validation/common";
import { APPOINTMENT_ACTIONS, TERMINAL_STATUSES } from "@/lib/validation/appointments";
import { patientSearchWhere } from "@/lib/services/patients";
import { getHospital } from "@/lib/services/settings";
import { notifyUser } from "@/lib/services/notifications";
import { sendEmail } from "@/lib/email";
import { D } from "@/lib/utils/money";
import { dayRangeUtc, formatDateTime, toZonedDateString, toZonedTimeString, todayInTz, zonedToUtc } from "@/lib/utils/time";
import { checkBooking, doctorIsBookable, generateSlots, loadDoctorDay, loadPatientOverlaps, lockScheduling, normaliseSlotMinutes, windowsForDate } from "@/lib/services/scheduling";

export const isSuperAdmin = (session) => session?.roles?.includes("SUPER_ADMIN");

const SORTABLE = { startsAt: "startsAt", appointmentNo: "appointmentNo", status: "status", createdAt: "createdAt" };

export const APPOINTMENT_LIST_INCLUDE = {
  patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } },
  doctor: { select: { id: true, specialty: true, staff: { select: { firstName: true, lastName: true } } } },
  department: { select: { id: true, name: true } },
  queueEntry: { select: { tokenNumber: true, status: true } },
};

export function appointmentWhere({ q, status, from, to, doctorId, departmentId, patientId, type }, tz) {
  const where = {};
  if (q) where.OR = [{ appointmentNo: { contains: q, mode: "insensitive" } }, { patient: patientSearchWhere(q) }];
  if (status && status !== "ALL") where.status = status;
  if (doctorId) where.doctorId = doctorId;
  if (departmentId) where.departmentId = departmentId;
  if (patientId) where.patientId = patientId;
  if (type) where.type = type;
  if (from || to) {
    where.startsAt = {};
    if (from) where.startsAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.startsAt.lt = dayRangeUtc(to, tz)[1];
  }
  return where;
}

export async function listAppointments(query, tz) {
  const where = appointmentWhere(query, tz);
  const orderBy = [{ [SORTABLE[query.sort] || "startsAt"]: query.dir || "desc" }, { id: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: APPOINTMENT_LIST_INCLUDE }),
  ]);
  return { rows, meta: pageMeta(total, query.page, query.pageSize) };
}

/** Appointments overlapping a UTC range for the calendar (capped to keep pages fast). */
export function calendarAppointments({ start, end, ...filters }, tz) {
  const where = { ...appointmentWhere({ ...filters, from: undefined, to: undefined }, tz), startsAt: { lt: end }, endsAt: { gt: start } };
  return prisma.appointment.findMany({ where, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 1500, include: APPOINTMENT_LIST_INCLUDE });
}

export function getAppointment(id) {
  return prisma.appointment.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phone: true, email: true, dateOfBirth: true, sex: true, status: true, medicalAlerts: true, consentToEmail: true } },
      doctor: { select: { id: true, specialty: true, slotMinutes: true, consultationFee: true, staff: { select: { firstName: true, lastName: true, userId: true } } } },
      department: { select: { id: true, name: true } },
      queueEntry: true,
      encounter: { select: { id: true, encounterNo: true, status: true } },
    },
  });
}

/** Doctors for pickers/filters (bookable only unless `all`). Plain, serialisable shape. */
export async function listDoctorOptions({ all = false } = {}) {
  const rows = await prisma.doctorProfile.findMany({
    where: all ? {} : { acceptsAppointments: true, staff: { employmentStatus: "ACTIVE" } },
    select: { id: true, specialty: true, slotMinutes: true, consultationFee: true, departmentId: true, department: { select: { name: true } }, staff: { select: { firstName: true, lastName: true } } },
    orderBy: [{ staff: { lastName: "asc" } }, { staff: { firstName: "asc" } }],
  });
  return rows.map((d) => ({ id: d.id, name: `${d.staff.firstName} ${d.staff.lastName}`, specialty: d.specialty, departmentId: d.departmentId, departmentName: d.department.name, consultationFee: d.consultationFee.toString(), slotMinutes: d.slotMinutes }));
}

export function listDepartmentOptions() {
  return prisma.department.findMany({ where: { isActive: true, isClinical: true, doctors: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

// ───────────────────────────── Slots ─────────────────────────────

export async function getSlots({ doctorId, date }, now = new Date()) {
  const h = await getHospital();
  const ctx = await loadDoctorDay(prisma, doctorId, date, h.timezone);
  if (!ctx) throw notFound("Doctor not found");
  const base = { doctorId, date, timezone: h.timezone, slotMinutes: normaliseSlotMinutes(ctx.doctor.slotMinutes) };
  if (!doctorIsBookable(ctx.doctor)) return { ...base, slots: [], message: "This doctor is not accepting appointments." };
  if (date < todayInTz(h.timezone)) return { ...base, slots: [], message: "That date is in the past." };
  const slots = generateSlots({ date, tz: h.timezone, availability: ctx.doctor.availability, slotMinutes: ctx.doctor.slotMinutes, exceptions: ctx.exceptions, appointments: ctx.appointments, now });
  let message;
  if (!slots.length) {
    if (!ctx.doctor.availability.length) message = "This doctor has no clinic hours configured.";
    else if (!windowsForDate(ctx.doctor.availability, date).length) message = "The doctor does not hold clinic on this day of the week.";
    else message = "No clinic sessions remain on this date.";
  }
  else if (!slots.some((s) => s.available)) message = ctx.exceptions.length ? "The doctor is unavailable on this date." : "All slots on this date are booked.";
  return { ...base, slots, ...(message ? { message } : {}) };
}

// ───────────────────────────── Helpers ─────────────────────────────

function bookingError(res) {
  return new ApiError(res.status, res.code === "PAST" || res.code === "OUTSIDE_AVAILABILITY" ? "INVALID_STATE" : "CONFLICT", res.message, { code: res.code });
}

async function loadBookablePatient(db, patientId) {
  const p = await db.patient.findUnique({ where: { id: patientId }, select: { id: true, status: true, email: true, consentToEmail: true } });
  if (!p || p.status === "MERGED") throw notFound("Patient not found");
  if (p.status !== "ACTIVE") throw invalidState("Only active patients can be booked.");
  return p;
}

/** Fee defaults to the doctor's consultation fee; overriding requires billing:discount. */
function resolveFee(inputFee, doctorFee, session) {
  if (inputFee == null || D(inputFee).eq(D(doctorFee))) return D(doctorFee).toFixed(2);
  if (!can(session, "billing:discount")) throw forbidden("Changing the consultation fee requires the billing:discount permission.");
  return D(inputFee).toFixed(2);
}

const doctorName = (d) => `Dr. ${d.staff.firstName} ${d.staff.lastName}`;

/**
 * Side effects after a booking change commits: in-app notification to the doctor and,
 * when the patient consented, a generic email (no clinical detail anywhere).
 * Failures here never fail the request.
 */
async function notifyBookingChange(appointmentId, kind) {
  try {
    const a = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, appointmentNo: true, startsAt: true, patient: { select: { email: true, consentToEmail: true, firstName: true } }, doctor: { select: { staff: { select: { firstName: true, lastName: true, userId: true } } } } },
    });
    if (!a) return;
    const h = await getHospital();
    const when = formatDateTime(a.startsAt, h.timezone);
    const titles = { created: "New appointment booked", rescheduled: "Appointment rescheduled", cancelled: "Appointment cancelled", walkin: "Walk-in patient added to your queue" };
    await notifyUser(a.doctor.staff.userId, { category: "APPOINTMENT", title: titles[kind], body: `${a.appointmentNo} · ${when}`, link: kind === "walkin" ? "/consultations" : `/appointments/${a.id}` });
    if (kind !== "walkin" && a.patient.email && a.patient.consentToEmail) {
      const verb = { created: "is booked", rescheduled: "has been rescheduled", cancelled: "has been cancelled" }[kind];
      const lines = [
        `Dear ${a.patient.firstName},`,
        "",
        `Your appointment ${a.appointmentNo} with ${doctorName(a.doctor)} ${verb}.`,
        kind === "cancelled" ? `It was scheduled for ${when}.` : `Date and time: ${when} (${h.timezone}).`,
        "",
        kind === "cancelled" ? "Please contact us if you would like to book another time." : "Please arrive 10 minutes early and bring any previous reports.",
        "",
        h.name,
        h.phone ? `Phone: ${h.phone}` : "",
      ].filter((l) => l !== null);
      await sendEmail({ to: a.patient.email, subject: `Your appointment at ${h.name}`, text: lines.join("\n") });
    }
  } catch (e) {
    console.error("[appointments] notification failed:", e?.code || e?.name || "error");
  }
}

// ───────────────────────────── Create / walk-in / update ─────────────────────────────

export async function createAppointment(input, session, ip, now = new Date()) {
  const h = await getHospital();
  const tz = h.timezone;
  const appt = await prisma.$transaction(async (tx) => {
    await lockScheduling(tx, { doctorId: input.doctorId, patientId: input.patientId });
    await loadBookablePatient(tx, input.patientId);
    const ctx = await loadDoctorDay(tx, input.doctorId, input.date, tz);
    if (!ctx) throw notFound("Doctor not found");
    if (!doctorIsBookable(ctx.doctor)) throw invalidState("This doctor is not accepting appointments.");
    const slot = normaliseSlotMinutes(ctx.doctor.slotMinutes);
    const startsAt = zonedToUtc(input.date, input.time, tz);
    const patientAppointments = await loadPatientOverlaps(tx, input.patientId, startsAt, new Date(startsAt.getTime() + slot * 60000));
    const res = checkBooking({ date: input.date, time: input.time, tz, availability: ctx.doctor.availability, slotMinutes: slot, exceptions: ctx.exceptions, doctorAppointments: ctx.appointments, patientAppointments, now });
    if (!res.ok) throw bookingError(res);
    const fee = resolveFee(input.fee, ctx.doctor.consultationFee, session);
    const created = await tx.appointment.create({
      data: {
        appointmentNo: await newId(tx, "appointment"),
        patientId: input.patientId, doctorId: ctx.doctor.id, departmentId: ctx.doctor.departmentId,
        startsAt: res.startsAt, endsAt: res.endsAt, type: input.type, status: "SCHEDULED",
        reason: input.reason ?? null, notes: input.notes ?? null, fee, createdById: session.user.id,
      },
    });
    await audit({ userId: session.user.id, action: "appointment.create", entityType: "Appointment", entityId: created.id, metadata: { appointmentNo: created.appointmentNo, doctorId: created.doctorId, patientId: created.patientId, startsAt: created.startsAt.toISOString(), feeOverridden: !D(fee).eq(D(ctx.doctor.consultationFee)) }, ipAddress: ip }, tx);
    return created;
  });
  await notifyBookingChange(appt.id, "created");
  return appt;
}

/** Next queue token for doctor+local day. Caller must hold the doctor's scheduling lock. */
async function nextToken(tx, doctorId, queueDate) {
  const agg = await tx.queueEntry.aggregate({ where: { queueDate, appointment: { doctorId } }, _max: { tokenNumber: true } });
  return (agg._max.tokenNumber ?? 0) + 1;
}

const queueDateFor = (localDate) => new Date(`${localDate}T00:00:00.000Z`);

/**
 * Walk-in: type WALK_IN, starts now, immediately CHECKED_IN with a queue token.
 * Deliberately bypasses availability windows and the doctor-overlap check (walk-ins join the
 * doctor's queue and are seen in token order between booked patients). Schedule exceptions
 * (leave) and patient double-booking are still enforced.
 */
export async function createWalkIn(input, session, ip, now = new Date()) {
  const h = await getHospital();
  const tz = h.timezone;
  const today = todayInTz(tz);
  const startsAt = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const result = await prisma.$transaction(async (tx) => {
    await lockScheduling(tx, { doctorId: input.doctorId, patientId: input.patientId });
    await loadBookablePatient(tx, input.patientId);
    const ctx = await loadDoctorDay(tx, input.doctorId, today, tz);
    if (!ctx) throw notFound("Doctor not found");
    if (!doctorIsBookable(ctx.doctor)) throw invalidState("This doctor is not accepting patients.");
    const slot = normaliseSlotMinutes(ctx.doctor.slotMinutes);
    const endsAt = new Date(startsAt.getTime() + slot * 60000);
    const patientAppointments = await loadPatientOverlaps(tx, input.patientId, startsAt, endsAt);
    const res = checkBooking({ date: today, time: toZonedTimeString(startsAt, tz), startsAt, tz, slotMinutes: slot, exceptions: ctx.exceptions, patientAppointments, now, bypassAvailability: true });
    if (!res.ok) throw bookingError(res);
    const fee = resolveFee(input.fee, ctx.doctor.consultationFee, session);
    const created = await tx.appointment.create({
      data: {
        appointmentNo: await newId(tx, "appointment"),
        patientId: input.patientId, doctorId: ctx.doctor.id, departmentId: ctx.doctor.departmentId,
        startsAt: res.startsAt, endsAt: res.endsAt, type: "WALK_IN", status: "CHECKED_IN", checkedInAt: now,
        reason: input.reason ?? null, notes: input.notes ?? null, fee, createdById: session.user.id,
      },
    });
    const queueDate = queueDateFor(today);
    const tokenNumber = await nextToken(tx, ctx.doctor.id, queueDate);
    const q = await tx.queueEntry.create({ data: { appointmentId: created.id, tokenNumber, queueDate, status: "WAITING" } });
    await audit({ userId: session.user.id, action: "appointment.walk_in", entityType: "Appointment", entityId: created.id, metadata: { appointmentNo: created.appointmentNo, doctorId: created.doctorId, patientId: created.patientId, tokenNumber }, ipAddress: ip }, tx);
    return { ...created, queueEntry: q };
  });
  await notifyBookingChange(result.id, "walkin");
  return result;
}

export async function updateAppointment(id, input, session, ip) {
  const existing = await prisma.appointment.findUnique({ where: { id }, include: { doctor: { select: { consultationFee: true } } } });
  if (!existing) throw notFound();
  if (TERMINAL_STATUSES.includes(existing.status)) throw invalidState("Completed, cancelled or no-show appointments can't be edited.");
  const data = {};
  if (input.type !== undefined) {
    if (existing.type === "WALK_IN") throw invalidState("The type of a walk-in can't be changed.");
    data.type = input.type;
  }
  if ("reason" in input) data.reason = input.reason ?? null;
  if ("notes" in input) data.notes = input.notes ?? null;
  if (input.fee !== undefined && !D(input.fee).eq(D(existing.fee))) {
    if (!can(session, "billing:discount")) throw forbidden("Changing the consultation fee requires the billing:discount permission.");
    data.fee = D(input.fee).toFixed(2);
  }
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  if (!changed.length) return existing;
  return prisma.$transaction(async (tx) => {
    const r = await tx.appointment.updateMany({ where: { id, status: existing.status, updatedAt: existing.updatedAt }, data });
    if (r.count === 0) throw conflict("The appointment was changed by someone else. Reload and try again.");
    await audit({ userId: session.user.id, action: "appointment.update", entityType: "Appointment", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return tx.appointment.findUnique({ where: { id } });
  });
}

// ───────────────────────────── State transitions ─────────────────────────────

function assertAction(action, appt) {
  const a = APPOINTMENT_ACTIONS[action];
  if (!a.from.includes(appt.status)) {
    throw invalidState(`Can't ${a.verb} this appointment: it is ${appt.status.replace(/_/g, " ").toLowerCase()}.`);
  }
  return a;
}

/** Race-safe status change: only succeeds if the row is still in one of the allowed source states. */
async function guardedUpdate(tx, id, from, data) {
  const r = await tx.appointment.updateMany({ where: { id, status: { in: from } }, data });
  if (r.count === 0) throw conflict("The appointment was changed by someone else. Reload and try again.");
}

export async function confirmAppointment(id, session, ip) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw notFound();
  const a = assertAction("confirm", appt);
  return prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, id, a.from, { status: "CONFIRMED" });
    await audit({ userId: session.user.id, action: "appointment.confirm", entityType: "Appointment", entityId: id, metadata: { from: appt.status }, ipAddress: ip }, tx);
    return tx.appointment.findUnique({ where: { id } });
  });
}

export async function checkInAppointment(id, session, ip, now = new Date()) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw notFound();
  const a = assertAction("check-in", appt);
  const h = await getHospital();
  const today = todayInTz(h.timezone);
  if (toZonedDateString(appt.startsAt, h.timezone) !== today) throw invalidState("Patients can only be checked in on the day of their appointment.");
  return prisma.$transaction(async (tx) => {
    await lockScheduling(tx, { doctorId: appt.doctorId });
    await guardedUpdate(tx, id, a.from, { status: "CHECKED_IN", checkedInAt: now });
    const queueDate = queueDateFor(today);
    const tokenNumber = await nextToken(tx, appt.doctorId, queueDate);
    const q = await tx.queueEntry.create({ data: { appointmentId: id, tokenNumber, queueDate, status: "WAITING" } });
    await audit({ userId: session.user.id, action: "appointment.check_in", entityType: "Appointment", entityId: id, metadata: { tokenNumber }, ipAddress: ip }, tx);
    return { ...(await tx.appointment.findUnique({ where: { id } })), queueEntry: q };
  });
}

export async function completeAppointment(id, session, ip, now = new Date()) {
  const appt = await prisma.appointment.findUnique({ where: { id }, include: { encounter: { select: { id: true, status: true } } } });
  if (!appt) throw notFound();
  const a = assertAction("complete", appt);
  if (!appt.encounter || appt.encounter.status !== "FINALIZED") throw invalidState("The consultation must be finalized before the appointment can be completed.");
  return prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, id, a.from, { status: "COMPLETED", completedAt: now });
    await tx.queueEntry.updateMany({ where: { appointmentId: id }, data: { status: "DONE" } });
    await audit({ userId: session.user.id, action: "appointment.complete", entityType: "Appointment", entityId: id, ipAddress: ip }, tx);
    return tx.appointment.findUnique({ where: { id } });
  });
}

export async function markNoShow(id, session, ip, now = new Date()) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw notFound();
  const a = assertAction("no-show", appt);
  if (appt.startsAt > now) throw invalidState("A no-show can only be recorded after the appointment time has passed.");
  return prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, id, a.from, { status: "NO_SHOW" });
    await audit({ userId: session.user.id, action: "appointment.no_show", entityType: "Appointment", entityId: id, ipAddress: ip }, tx);
    return tx.appointment.findUnique({ where: { id } });
  });
}

export async function cancelAppointment(id, reason, session, ip) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw notFound();
  const a = assertAction("cancel", appt);
  const updated = await prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, id, a.from, { status: "CANCELLED", cancelReason: reason });
    // A checked-in patient who leaves is recorded as LEFT in the queue.
    await tx.queueEntry.updateMany({ where: { appointmentId: id, status: { in: ["WAITING", "CALLED"] } }, data: { status: "LEFT" } });
    await audit({ userId: session.user.id, action: "appointment.cancel", entityType: "Appointment", entityId: id, metadata: { from: appt.status, reason }, ipAddress: ip }, tx);
    return tx.appointment.findUnique({ where: { id } });
  });
  await notifyBookingChange(id, "cancelled");
  return updated;
}

export async function rescheduleAppointment(id, input, session, ip, now = new Date()) {
  const existing = await prisma.appointment.findUnique({ where: { id } });
  if (!existing) throw notFound();
  const a = assertAction("reschedule", existing);
  const h = await getHospital();
  const tz = h.timezone;
  const updated = await prisma.$transaction(async (tx) => {
    await lockScheduling(tx, { doctorId: existing.doctorId, patientId: existing.patientId });
    const ctx = await loadDoctorDay(tx, existing.doctorId, input.date, tz);
    if (!ctx) throw notFound("Doctor not found");
    if (!doctorIsBookable(ctx.doctor)) throw invalidState("This doctor is not accepting appointments.");
    const slot = normaliseSlotMinutes(ctx.doctor.slotMinutes);
    const startsAt = zonedToUtc(input.date, input.time, tz);
    if (startsAt.getTime() === existing.startsAt.getTime()) throw invalidState("Choose a different time from the current one.");
    const patientAppointments = await loadPatientOverlaps(tx, existing.patientId, startsAt, new Date(startsAt.getTime() + slot * 60000));
    const res = checkBooking({ date: input.date, time: input.time, tz, availability: ctx.doctor.availability, slotMinutes: slot, exceptions: ctx.exceptions, doctorAppointments: ctx.appointments, patientAppointments, now, excludeId: id });
    if (!res.ok) throw bookingError(res);
    const r = await tx.appointment.updateMany({ where: { id, status: { in: a.from }, startsAt: existing.startsAt }, data: { startsAt: res.startsAt, endsAt: res.endsAt } });
    if (r.count === 0) throw conflict("The appointment was changed by someone else. Reload and try again.");
    await audit({ userId: session.user.id, action: "appointment.reschedule", entityType: "Appointment", entityId: id, metadata: { from: existing.startsAt.toISOString(), to: res.startsAt.toISOString(), ...(input.reason ? { reason: input.reason } : {}) }, ipAddress: ip }, tx);
    return tx.appointment.findUnique({ where: { id } });
  });
  await notifyBookingChange(id, "rescheduled");
  return updated;
}
