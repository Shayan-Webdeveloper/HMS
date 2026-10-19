import "server-only";
import { zonedToUtc, weekdayOf, minutesFromHHMM, hhmmFromMinutes, dayRangeUtc } from "@/lib/utils/time";

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling engine.
//
// Everything above the "Database helpers" divider is PURE (no I/O, `now` is
// injected) so it can be unit-tested. Availability windows are stored in hospital
// local time ("09:00"–"13:00" per weekday); instants are stored in UTC. The
// hospital time zone converts between the two.
// ─────────────────────────────────────────────────────────────────────────────

/** Appointment statuses that no longer occupy a slot. */
export const NON_BLOCKING_STATUSES = ["CANCELLED", "NO_SHOW"];
export const isBlocking = (status) => !NON_BLOCKING_STATUSES.includes(status);

export const MIN_SLOT_MINUTES = 5;
export const MAX_SLOT_MINUTES = 240;
export function normaliseSlotMinutes(n) {
  const v = Number(n);
  return Number.isInteger(v) && v >= MIN_SLOT_MINUTES && v <= MAX_SLOT_MINUTES ? v : 15;
}

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅. Touching intervals do not overlap. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return ms(aStart) < ms(bEnd) && ms(bStart) < ms(aEnd);
}

/** Blocking appointments (not cancelled / no-show) that overlap [start, end), optionally excluding one id. */
export function findOverlappingAppointments(appointments, start, end, excludeId) {
  return appointments.filter((a) => a.id !== excludeId && isBlocking(a.status) && overlaps(a.startsAt, a.endsAt, start, end));
}

export function findOverlappingExceptions(exceptions, start, end) {
  return exceptions.filter((e) => overlaps(e.startsAt, e.endsAt, start, end));
}

/** Availability rows → sorted [{start,end}] minute windows for the weekday of `date` (YYYY-MM-DD, local). */
export function windowsForDate(availability, date) {
  const wd = weekdayOf(date);
  return availability
    .filter((a) => Number(a.weekday) === wd)
    .map((a) => ({ start: minutesFromHHMM(a.startTime), end: minutesFromHHMM(a.endTime) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
}

/** Slot start offsets (minutes after local midnight) stepped by slotMinutes; a slot must end inside its window. */
export function slotStartsForWindows(windows, slotMinutes) {
  const step = normaliseSlotMinutes(slotMinutes);
  const set = new Set();
  for (const w of windows) for (let m = w.start; m + step <= w.end; m += step) set.add(m);
  return [...set].sort((a, b) => a - b);
}

/** True when a slot starting at `startMin` lies fully inside a window and on that window's slot grid. */
export function isWithinAvailability(windows, startMin, slotMinutes) {
  const step = normaliseSlotMinutes(slotMinutes);
  return windows.some((w) => startMin >= w.start && startMin + step <= w.end && (startMin - w.start) % step === 0);
}

/**
 * Bookable slots for one doctor on one local date.
 * Past slots (start ≤ now) are omitted. Slots blocked by a schedule exception or an
 * existing appointment are returned with available:false and a reason.
 * @returns {{ start: string, startsAt: string, endsAt: string, available: boolean, reason?: "booked"|"unavailable" }[]}
 */
export function generateSlots({ date, tz, availability = [], slotMinutes, exceptions = [], appointments = [], now = new Date() }) {
  const step = normaliseSlotMinutes(slotMinutes);
  const starts = slotStartsForWindows(windowsForDate(availability, date), step);
  const nowMs = ms(now);
  const out = [];
  for (const m of starts) {
    const start = hhmmFromMinutes(m);
    const startsAt = zonedToUtc(date, start, tz);
    if (startsAt.getTime() <= nowMs) continue;
    const endsAt = new Date(startsAt.getTime() + step * 60000);
    let reason;
    if (findOverlappingExceptions(exceptions, startsAt, endsAt).length) reason = "unavailable";
    else if (findOverlappingAppointments(appointments, startsAt, endsAt).length) reason = "booked";
    out.push({ start, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), available: !reason, ...(reason ? { reason } : {}) });
  }
  return out;
}

/**
 * Validate a booking request against the loaded schedule. Pure.
 * `bypassAvailability` (walk-ins) skips the window/grid/past checks and the doctor-overlap
 * check (walk-ins join the queue), but schedule exceptions and patient double-booking still apply.
 * @returns {{ ok: true, startsAt: Date, endsAt: Date } | { ok: false, status: number, code: string, message: string, conflictWith?: object }}
 */
export function checkBooking({ date, time, startsAt: startsAtIn, tz, availability = [], slotMinutes, exceptions = [], doctorAppointments = [], patientAppointments = [], now = new Date(), excludeId, bypassAvailability = false }) {
  const step = normaliseSlotMinutes(slotMinutes);
  const startsAt = startsAtIn ? new Date(startsAtIn) : zonedToUtc(date, time, tz);
  const endsAt = new Date(startsAt.getTime() + step * 60000);
  if (!bypassAvailability) {
    if (startsAt.getTime() <= ms(now)) return { ok: false, status: 422, code: "PAST", message: "That time has already passed. Choose a future slot." };
    if (!isWithinAvailability(windowsForDate(availability, date), minutesFromHHMM(time), step)) {
      return { ok: false, status: 422, code: "OUTSIDE_AVAILABILITY", message: "The doctor does not hold clinic at that time. Choose one of the available slots." };
    }
  }
  if (findOverlappingExceptions(exceptions, startsAt, endsAt).length) {
    return { ok: false, status: 409, code: "SCHEDULE_EXCEPTION", message: "The doctor is unavailable at that time (leave or schedule exception)." };
  }
  if (!bypassAvailability) {
    const clash = findOverlappingAppointments(doctorAppointments, startsAt, endsAt, excludeId);
    if (clash.length) return { ok: false, status: 409, code: "SLOT_TAKEN", message: "This slot is no longer available — it was just booked. Please choose another time.", conflictWith: { id: clash[0].id } };
  }
  const pClash = findOverlappingAppointments(patientAppointments, startsAt, endsAt, excludeId);
  if (pClash.length) {
    return { ok: false, status: 409, code: "PATIENT_CONFLICT", message: `The patient already has an overlapping appointment${pClash[0].appointmentNo ? ` (${pClash[0].appointmentNo})` : ""}.`, conflictWith: { id: pClash[0].id } };
  }
  return { ok: true, startsAt, endsAt };
}

// ───────────────────────────── Database helpers ─────────────────────────────
// These accept `db` (the prisma client or a transaction client) so callers decide
// the transaction boundary; this module never imports the client itself.

/**
 * Serialise all bookings for one doctor (and optionally one patient) until the
 * surrounding transaction ends. Always lock doctor before patient to avoid deadlocks.
 */
export async function lockScheduling(tx, { doctorId, patientId }) {
  if (doctorId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorId}))`;
  if (patientId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"patient:" + patientId}))`;
}

/** Load everything needed to compute or validate slots for doctor+date. Returns null if the doctor does not exist. */
export async function loadDoctorDay(db, doctorId, date, tz) {
  const doctor = await db.doctorProfile.findUnique({
    where: { id: doctorId },
    select: {
      id: true, slotMinutes: true, acceptsAppointments: true, departmentId: true, consultationFee: true, specialty: true,
      staff: { select: { firstName: true, lastName: true, userId: true, employmentStatus: true } },
      availability: { select: { weekday: true, startTime: true, endTime: true } },
    },
  });
  if (!doctor) return null;
  const [dayStart, dayEnd] = dayRangeUtc(date, tz);
  const exceptions = await db.scheduleException.findMany({ where: { doctorId, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }, select: { id: true, startsAt: true, endsAt: true } });
  const appointments = await db.appointment.findMany({
    where: { doctorId, status: { notIn: NON_BLOCKING_STATUSES }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
    select: { id: true, appointmentNo: true, startsAt: true, endsAt: true, status: true },
  });
  return { doctor, exceptions, appointments };
}

/** A patient's blocking appointments overlapping [start, end). */
export function loadPatientOverlaps(db, patientId, start, end) {
  return db.appointment.findMany({
    where: { patientId, status: { notIn: NON_BLOCKING_STATUSES }, startsAt: { lt: end }, endsAt: { gt: start } },
    select: { id: true, appointmentNo: true, startsAt: true, endsAt: true, status: true },
  });
}

export function doctorIsBookable(doctor) {
  return !!doctor && doctor.acceptsAppointments && doctor.staff?.employmentStatus === "ACTIVE";
}
