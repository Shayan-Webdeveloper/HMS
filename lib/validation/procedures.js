import { z } from "zod";
import { id, requiredText, optionalText, dateString, timeString, money } from "./common.js";

// ───────────────────────────── Operating theatre ─────────────────────────────

export const PROCEDURE_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
export const PROCEDURE_ACTIVE_STATUSES = ["SCHEDULED", "IN_PROGRESS"];

export const PROCEDURE_TRANSITIONS = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const canProcedureTransition = (from, to) => (PROCEDURE_TRANSITIONS[from] || []).includes(to);

/** A procedure may only start once the full pre-procedure checklist has been confirmed. */
export function procedureStartBlocker(p) {
  if (p.status !== "SCHEDULED") return "Only scheduled procedures can be started.";
  if (!p.checklistComplete) return "Complete the pre-procedure checklist before starting.";
  return null;
}

/** Fixed pre-procedure safety checklist. Completion is stored only when every item is confirmed. */
export const CHECKLIST_ITEMS = [
  { key: "identity", label: "Patient identity confirmed" },
  { key: "consent", label: "Consent signed" },
  { key: "site", label: "Procedure site marked" },
  { key: "fasting", label: "Fasting status confirmed" },
  { key: "allergies", label: "Allergies reviewed" },
];
export const CHECKLIST_KEYS = CHECKLIST_ITEMS.map((i) => i.key);
export const isChecklistComplete = (items) => CHECKLIST_KEYS.every((k) => items?.[k] === true);

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅. Back-to-back slots do not overlap. */
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

/**
 * Classify clashes between a candidate booking and existing procedures.
 * Only SCHEDULED / IN_PROGRESS procedures block a slot; the candidate itself (same id) is ignored.
 * Returns { theatre: [...], surgeon: [...] } — a procedure can appear in both.
 */
export function findScheduleConflicts(candidate, existing) {
  const theatre = [], surgeon = [];
  for (const p of existing) {
    if (candidate.id && p.id === candidate.id) continue;
    if (!PROCEDURE_ACTIVE_STATUSES.includes(p.status)) continue;
    if (!intervalsOverlap(candidate.scheduledStart, candidate.scheduledEnd, p.scheduledStart, p.scheduledEnd)) continue;
    if (p.theatreId === candidate.theatreId) theatre.push(p);
    if (p.surgeonId === candidate.surgeonId) surgeon.push(p);
  }
  return { theatre, surgeon, any: theatre.length > 0 || surgeon.length > 0 };
}

/** Position of a block on a day timeline (percentages of the visible window). */
export function timelineBlock(startMin, endMin, windowStart, windowEnd) {
  const span = windowEnd - windowStart;
  const s = Math.max(startMin, windowStart), e = Math.min(endMin, windowEnd);
  return { left: ((s - windowStart) / span) * 100, width: Math.max(((e - s) / span) * 100, 0.8) };
}

export const procedureSchema = z.object({
  patientId: id,
  surgeonId: z.string({ error: "Choose the surgeon" }).min(1, "Choose the surgeon").max(64),
  theatreId: z.string({ error: "Choose a theatre" }).min(1, "Choose a theatre").max(64),
  name: requiredText(200, "Procedure name"),
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  charge: money,
  notes: optionalText(4000),
}).refine((v) => v.endTime > v.startTime, { path: ["endTime"], message: "End time must be after the start time" });

export const checklistSchema = z.object({
  items: z.object(Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, z.boolean()]))),
}).refine((v) => isChecklistComplete(v.items), { path: ["items"], message: "Every checklist item must be confirmed" });

export const procedureStatusSchema = z.object({
  status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  postOpNotes: optionalText(8000),
  reason: optionalText(300),
})
  .refine((v) => v.status !== "COMPLETED" || (v.postOpNotes && v.postOpNotes.length >= 5), { path: ["postOpNotes"], message: "Post-operative notes are required to complete the procedure" })
  .refine((v) => v.status !== "CANCELLED" || (v.reason && v.reason.length >= 3), { path: ["reason"], message: "Give a reason for cancelling" });

export const procedureNotesSchema = z.object({
  notes: optionalText(4000),
});

export const theatreSchema = z.object({
  name: requiredText(60, "Theatre name"),
});

export const theatreUpdateSchema = z.object({
  name: requiredText(60, "Theatre name").optional(),
  isActive: z.boolean().optional(),
});
