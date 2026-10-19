import { z } from "zod";
import { id, requiredText, optionalText, money, listQuery } from "./common.js";

// ───────────────────────── Constants ─────────────────────────

export const LAB_STATUSES = ["REQUESTED", "SAMPLE_COLLECTED", "PROCESSING", "AWAITING_VALIDATION", "RELEASED", "CANCELLED", "REJECTED"];
export const LAB_ACTIVE_STATUSES = ["REQUESTED", "SAMPLE_COLLECTED", "PROCESSING", "AWAITING_VALIDATION"];
export const LAB_PRIORITIES = ["ROUTINE", "URGENT", "STAT"];
/** Worklist order: most urgent first. */
export const PRIORITY_ORDER = ["STAT", "URGENT", "ROUTINE"];

export const LAB_STATUS_LABELS = {
  REQUESTED: "Awaiting collection",
  SAMPLE_COLLECTED: "Sample collected",
  PROCESSING: "Processing",
  AWAITING_VALIDATION: "Awaiting validation",
  RELEASED: "Released",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
};

/**
 * Explicit lab order state machine. Anything not listed is refused by the service.
 *  REQUESTED → SAMPLE_COLLECTED (collect) | CANCELLED
 *  SAMPLE_COLLECTED → PROCESSING | REQUESTED (specimen rejected, recollect) | REJECTED (do not recollect) | CANCELLED
 *  PROCESSING → AWAITING_VALIDATION (all results entered) | REQUESTED | REJECTED (specimen rejected)
 *  AWAITING_VALIDATION → RELEASED (validated) | REQUESTED | REJECTED (specimen rejected before first release)
 *  RELEASED → AWAITING_VALIDATION (post-release correction requires re-validation)
 *  CANCELLED, REJECTED → terminal
 */
export const LAB_ALLOWED = {
  REQUESTED: ["SAMPLE_COLLECTED", "CANCELLED"],
  SAMPLE_COLLECTED: ["PROCESSING", "REQUESTED", "REJECTED", "CANCELLED"],
  PROCESSING: ["AWAITING_VALIDATION", "REQUESTED", "REJECTED"],
  AWAITING_VALIDATION: ["RELEASED", "REQUESTED", "REJECTED"],
  RELEASED: ["AWAITING_VALIDATION"],
  CANCELLED: [],
  REJECTED: [],
};

export function canTransitionLab(from, to) {
  return Boolean(LAB_ALLOWED[from]?.includes(to));
}

// ───────────────────────── Result flagging ─────────────────────────

const NUMERIC_RE = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/** Strictly parse a result value as a number. "<0.5", "1,200", "positive" etc. are NOT numeric. */
export function parseNumericValue(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!NUMERIC_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toBound(v) {
  if (v == null || v === "") return null;
  const n = Number(typeof v === "object" && typeof v.toString === "function" ? v.toString() : v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Flag a result ONLY by comparing a numeric value with the configured reference bounds
 * (inclusive). Returns "LOW" | "HIGH" | "NORMAL", or null when the value is not numeric or
 * no numeric range is configured. This is not a clinical interpretation.
 */
export function computeFlag(value, referenceLow, referenceHigh) {
  const n = parseNumericValue(value);
  if (n == null) return null;
  const lo = toBound(referenceLow);
  const hi = toBound(referenceHigh);
  if (lo == null && hi == null) return null;
  if (lo != null && n < lo) return "LOW";
  if (hi != null && n > hi) return "HIGH";
  return "NORMAL";
}

/**
 * Flag for a stored result. If the technologist reports in a unit different from the
 * configured one, the configured range does not apply, so no flag is computed.
 */
export function flagForResult(test, value, unit) {
  const cfgUnit = test?.unit ? String(test.unit).trim() : "";
  const u = unit ? String(unit).trim() : "";
  if (cfgUnit && u && u !== cfgUnit) return null;
  return computeFlag(value, test?.referenceLow, test?.referenceHigh);
}

/** "12.500" → "12.5", "150.000" → "150" */
export function trimDecimal(v) {
  if (v == null || v === "") return null;
  const s = String(v);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Human-readable reference range from the test configuration. */
export function formatReferenceRange(test) {
  const lo = trimDecimal(test?.referenceLow?.toString?.() ?? test?.referenceLow);
  const hi = trimDecimal(test?.referenceHigh?.toString?.() ?? test?.referenceHigh);
  if (lo != null && hi != null) return `${lo}–${hi}`;
  if (lo != null) return `≥ ${lo}`;
  if (hi != null) return `≤ ${hi}`;
  return test?.referenceText || null;
}

/** Range with unit for display, e.g. "12–17.5 g/dL" or the free-text reference. */
export function describeReference(test) {
  const present = (v) => v != null && v !== "";
  const hasNumeric = present(test?.referenceLow) || present(test?.referenceHigh);
  if (!hasNumeric) return test?.referenceText || null;
  const range = formatReferenceRange(test);
  return [`${range}${test?.unit ? ` ${test.unit}` : ""}`, test?.referenceText].filter(Boolean).join(" · ");
}

// ───────────────────────── Worklist paging by priority ─────────────────────────

/**
 * Plan which slice of each ordered segment (e.g. STAT, URGENT, ROUTINE) makes up one page,
 * so "most urgent first" paging works without raw SQL.
 * counts: { [key]: number }, order: key[], skip/take: page window → [{ key, skip, take }]
 */
export function planSegments(counts, order, skip, take) {
  const plan = [];
  let start = 0;
  let pos = Math.max(0, skip);
  let remaining = Math.max(0, take);
  for (const key of order) {
    const n = counts[key] || 0;
    const end = start + n;
    if (remaining > 0 && pos < end) {
      const s = pos - start;
      const t = Math.min(end - pos, remaining);
      plan.push({ key, skip: s, take: t });
      pos += t;
      remaining -= t;
    }
    start = end;
  }
  return plan;
}

// ───────────────────────── Schemas ─────────────────────────

const optionalId = z.preprocess((v) => (v === "" || v == null ? undefined : v), id.optional());

export const labOrderSchema = z.object({
  patientId: id,
  encounterId: optionalId,
  testIds: z.array(id, { error: "Select at least one test" }).min(1, "Select at least one test").max(40, "Too many tests in one order (max 40)")
    .refine((a) => new Set(a).size === a.length, "Each test can only be ordered once"),
  priority: z.enum(LAB_PRIORITIES, { error: "Choose a priority" }).default("ROUTINE"),
  clinicalNotes: optionalText(1000),
});

export const labListQuery = listQuery.extend({
  priority: z.preprocess((v) => (v === "" ? undefined : v), z.enum(LAB_PRIORITIES).optional()),
  mine: z.preprocess((v) => v === "1" || v === "true" || v === true, z.boolean()).optional(),
  patientId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  encounterId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
});

export const reasonSchema = z.object({
  reason: z.string({ error: "A reason is required" }).trim().min(3, "Please give a reason (min 3 characters)").max(300),
});

export const rejectSpecimenSchema = reasonSchema.extend({
  recollect: z.boolean().default(true),
});

const resultValue = z.string({ error: "Enter a result" }).trim().min(1, "Enter a result").max(100)
  .refine((v) => { const n = parseNumericValue(v); return n == null || Math.abs(n) < 1e9; }, "Numeric value is out of range");

export const resultEntrySchema = z.object({
  results: z.array(z.object({
    orderItemId: id,
    value: resultValue,
    unit: optionalText(40),
    comment: optionalText(500),
  })).min(1, "Enter at least one result").max(40),
});

export const correctionSchema = z.object({
  orderItemId: id,
  value: resultValue,
  unit: optionalText(40),
  comment: optionalText(500),
  reason: z.string({ error: "A correction reason is required" }).trim().min(3, "Please give a correction reason (min 3 characters)").max(300),
});

// Catalogue management
const optionalBound = z.preprocess(
  (v) => (v === "" || v == null ? undefined : String(v).trim()),
  z.string().regex(/^-?\d{1,9}(\.\d{1,3})?$/, "Enter a number (max 3 decimals)").optional(),
);

export const labTestSchema = z.object({
  code: z.string({ error: "Code is required" }).trim().min(1, "Code is required").max(20)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9][A-Z0-9_-]*$/.test(v), "Use letters, digits, - or _ only"),
  name: requiredText(120, "Name"),
  category: requiredText(60, "Category"),
  specimenType: requiredText(80, "Specimen type"),
  unit: optionalText(40),
  referenceLow: optionalBound,
  referenceHigh: optionalBound,
  referenceText: optionalText(200),
  price: money,
  turnaroundHours: z.coerce.number({ error: "Enter hours" }).int("Whole hours only").min(1, "At least 1 hour").max(720, "Max 720 hours"),
}).superRefine((v, ctx) => {
  if (v.referenceLow != null && v.referenceHigh != null && Number(v.referenceLow) > Number(v.referenceHigh)) {
    ctx.addIssue({ code: "custom", path: ["referenceHigh"], message: "High must be greater than or equal to low" });
  }
});

export const labTestActiveSchema = z.object({ isActive: z.boolean() });
