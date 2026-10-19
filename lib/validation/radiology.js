import { z } from "zod";
import { id, requiredText, optionalText, money, dateString, timeString, listQuery } from "./common.js";

export const IMAGING_STATUSES = ["REQUESTED", "SCHEDULED", "IN_PROGRESS", "REPORTED", "VERIFIED", "CANCELLED"];
export const IMAGING_ACTIVE_STATUSES = ["REQUESTED", "SCHEDULED", "IN_PROGRESS", "REPORTED"];

export const MODALITIES = ["XRAY", "US", "CT", "MRI", "MAMMO", "FLUORO"];
export const MODALITY_LABELS = { XRAY: "X-ray", US: "Ultrasound", CT: "CT", MRI: "MRI", MAMMO: "Mammography", FLUORO: "Fluoroscopy" };
export const modalityLabel = (m) => MODALITY_LABELS[m] || m;

export const IMAGING_STATUS_LABELS = {
  REQUESTED: "Requested",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  REPORTED: "Awaiting verification",
  VERIFIED: "Verified",
  CANCELLED: "Cancelled",
};

/**
 * Explicit imaging state machine.
 *  REQUESTED → SCHEDULED | IN_PROGRESS (walk-in) | CANCELLED
 *  SCHEDULED → SCHEDULED (reschedule) | IN_PROGRESS | CANCELLED
 *  IN_PROGRESS → REPORTED | CANCELLED
 *  REPORTED → REPORTED (edit report before verification) | VERIFIED
 *  VERIFIED, CANCELLED → terminal
 */
export const IMAGING_ALLOWED = {
  REQUESTED: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  SCHEDULED: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["REPORTED", "CANCELLED"],
  REPORTED: ["REPORTED", "VERIFIED"],
  VERIFIED: [],
  CANCELLED: [],
};

export function canTransitionImaging(from, to) {
  return Boolean(IMAGING_ALLOWED[from]?.includes(to));
}

const optionalId = z.preprocess((v) => (v === "" || v == null ? undefined : v), id.optional());

export const imagingRequestSchema = z.object({
  patientId: id,
  encounterId: optionalId,
  catalogCode: z.string({ error: "Choose an examination" }).trim().min(1, "Choose an examination").max(40),
  indication: optionalText(1000),
});

export const imagingListQuery = listQuery.extend({
  modality: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(20).optional()),
  patientId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  encounterId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
});

export const scheduleSchema = z.object({
  date: dateString,
  time: timeString,
});

export const imagingReportSchema = z.object({
  findings: requiredText(10000, "Findings"),
  impression: requiredText(4000, "Impression"),
});

export const imagingCancelSchema = z.object({
  reason: z.string({ error: "A reason is required" }).trim().min(3, "Please give a reason (min 3 characters)").max(300),
});

export const catalogItemSchema = z.object({
  code: z.string({ error: "Code is required" }).trim().min(1, "Code is required").max(30)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9][A-Z0-9_-]*$/.test(v), "Use letters, digits, - or _ only"),
  modality: z.enum(MODALITIES, { error: "Choose a modality" }),
  bodyPart: requiredText(120, "Examination / body part"),
  price: money,
});

export const imagingCatalogSchema = z.object({
  items: z.array(catalogItemSchema).max(300, "Too many items (max 300)"),
}).superRefine((v, ctx) => {
  const seen = new Map();
  v.items.forEach((it, i) => {
    if (seen.has(it.code)) ctx.addIssue({ code: "custom", path: ["items", i, "code"], message: `Duplicate code ${it.code}` });
    else seen.set(it.code, i);
  });
});
