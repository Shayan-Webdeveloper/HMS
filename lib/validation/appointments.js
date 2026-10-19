import { z } from "zod";
import { id, optionalText, requiredText, dateString, timeString, money, listQuery } from "./common.js";

export const APPOINTMENT_STATUSES = ["REQUESTED", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"];
export const APPOINTMENT_TYPES = ["NEW", "FOLLOW_UP", "WALK_IN", "TELECONSULT"];
/** Types staff can choose when booking ahead (walk-ins use the dedicated endpoint). */
export const BOOKABLE_TYPES = ["NEW", "FOLLOW_UP", "TELECONSULT"];
export const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];

export const typeLabel = (t) => ({ NEW: "New visit", FOLLOW_UP: "Follow-up", WALK_IN: "Walk-in", TELECONSULT: "Teleconsult" })[t] || t;

// ───────────── Appointment state machine (shared by API and UI) ─────────────
// Every transition is an explicit action. Anything not listed is rejected.
export const APPOINTMENT_ACTIONS = {
  confirm: { from: ["REQUESTED", "SCHEDULED"], to: "CONFIRMED", permission: "appointments:update", label: "Confirm", verb: "confirm" },
  "check-in": { from: ["SCHEDULED", "CONFIRMED"], to: "CHECKED_IN", permission: "appointments:update", label: "Check in", verb: "check in" },
  start: { from: ["CHECKED_IN"], to: "IN_PROGRESS", permission: "encounters:create", label: "Start consultation", verb: "start a consultation for" },
  complete: { from: ["IN_PROGRESS"], to: "COMPLETED", permission: "appointments:update", label: "Mark completed", verb: "complete" },
  "no-show": { from: ["SCHEDULED", "CONFIRMED"], to: "NO_SHOW", permission: "appointments:update", label: "Mark no-show", verb: "mark as no-show" },
  cancel: { from: ["REQUESTED", "SCHEDULED", "CONFIRMED", "CHECKED_IN"], to: "CANCELLED", permission: "appointments:cancel", label: "Cancel", verb: "cancel" },
  reschedule: { from: ["REQUESTED", "SCHEDULED", "CONFIRMED"], to: null, permission: "appointments:update", label: "Reschedule", verb: "reschedule" },
};

/** Map of status → statuses reachable in one step (derived from the actions). */
export const APPOINTMENT_TRANSITIONS = Object.fromEntries(
  APPOINTMENT_STATUSES.map((s) => [s, [...new Set(Object.values(APPOINTMENT_ACTIONS).filter((a) => a.to && a.from.includes(s)).map((a) => a.to))]]),
);

export function canTransition(from, to) {
  return (APPOINTMENT_TRANSITIONS[from] || []).includes(to);
}

/** Action keys allowed from a status (permission checks are separate). */
export function actionsFor(status) {
  return Object.entries(APPOINTMENT_ACTIONS).filter(([, a]) => a.from.includes(status)).map(([k]) => k);
}

export function isActionAllowed(action, status) {
  const a = APPOINTMENT_ACTIONS[action];
  return !!a && a.from.includes(status);
}

// ───────────── Schemas ─────────────
/** YYYY-MM-DD that is also a real calendar date (rejects 2026-13-40). */
export const isRealDate = (v) => {
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const realDate = dateString.refine(isRealDate, "Use a valid date");
const optionalFee = z.preprocess((v) => (v === "" || v == null ? undefined : v), money.optional());

export const appointmentCreateSchema = z.object({
  patientId: id,
  doctorId: id,
  date: realDate,
  time: timeString,
  type: z.enum(BOOKABLE_TYPES).default("NEW"),
  reason: optionalText(300),
  notes: optionalText(1000),
  fee: optionalFee,
});

export const appointmentUpdateSchema = z.object({
  type: z.enum(BOOKABLE_TYPES).optional(),
  reason: optionalText(300),
  notes: optionalText(1000),
  fee: optionalFee,
});

export const rescheduleSchema = z.object({
  date: realDate,
  time: timeString,
  reason: optionalText(300),
});

export const cancelSchema = z.object({ reason: requiredText(300, "Reason").refine((v) => v.length >= 3, "Please give a reason (min 3 characters)") });

export const walkInSchema = z.object({
  patientId: id,
  doctorId: id,
  reason: optionalText(300),
  notes: optionalText(1000),
  fee: optionalFee,
});

export const slotsQuery = z.object({ doctorId: id, date: realDate });

export const appointmentListQuery = listQuery.extend({
  doctorId: z.string().max(64).optional(),
  departmentId: z.string().max(64).optional(),
  patientId: z.string().max(64).optional(),
  type: z.enum(APPOINTMENT_TYPES).optional().catch(undefined),
});
