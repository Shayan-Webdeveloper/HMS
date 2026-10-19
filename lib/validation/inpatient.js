import { z } from "zod";
import { id, requiredText, optionalText, optionalDate, money } from "./common.js";
import { toZonedDateString } from "../utils/time.js";

// ───────────────────────────── Wards & beds ─────────────────────────────

export const WARD_TYPES = ["GENERAL", "ICU", "PRIVATE", "PEDIATRIC", "MATERNITY"];
export const BED_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "OUT_OF_SERVICE"];

/**
 * Manual bed status changes (staff actions on the bed board).
 * OCCUPIED beds have no manual transitions — they only change through the
 * admission workflows (discharge/transfer move the bed to CLEANING), and no
 * manual action may move a bed INTO OCCUPIED.
 */
export const BED_MANUAL_TRANSITIONS = {
  AVAILABLE: ["RESERVED", "CLEANING", "OUT_OF_SERVICE"],
  RESERVED: ["AVAILABLE", "OUT_OF_SERVICE"],
  CLEANING: ["AVAILABLE", "OUT_OF_SERVICE"],
  OUT_OF_SERVICE: ["AVAILABLE", "CLEANING"],
  OCCUPIED: [],
};

export function canChangeBedStatus(from, to) {
  if (from === to) return false;
  return (BED_MANUAL_TRANSITIONS[from] || []).includes(to);
}

export const bedStatusRequiresReason = (to) => to === "OUT_OF_SERVICE";

/** Human label for a manual bed action, used by the UI. */
export function bedActionLabel(from, to) {
  if (from === "CLEANING" && to === "AVAILABLE") return "Mark clean";
  if (from === "OUT_OF_SERVICE" && to === "AVAILABLE") return "Return to service";
  if (from === "RESERVED" && to === "AVAILABLE") return "Release reservation";
  if (to === "RESERVED") return "Reserve";
  if (to === "CLEANING") return "Send for cleaning";
  if (to === "OUT_OF_SERVICE") return "Take out of service";
  return `Set ${to.toLowerCase().replace(/_/g, " ")}`;
}

const wardCode = z.string({ error: "Code is required" }).trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,11}$/, "Use 1–12 letters, digits or dashes");
const bedLabel = z.string().trim().min(1, "Label is required").max(20, "Max 20 characters").regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, "Use letters, digits, spaces, dot, dash or slash");

export const wardSchema = z.object({
  name: requiredText(120, "Ward name"),
  code: wardCode,
  type: z.enum(WARD_TYPES, { error: "Choose a ward type" }),
  dailyRate: money,
  departmentId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  isActive: z.boolean().optional().default(true),
});

export const addBedsSchema = z.object({
  labels: z.array(bedLabel).min(1, "Add at least one bed").max(50, "Add at most 50 beds at a time"),
}).refine((v) => new Set(v.labels.map((l) => l.toLowerCase())).size === v.labels.length, { path: ["labels"], message: "Bed labels must be unique" });

export const bedStatusSchema = z.object({
  status: z.enum(["AVAILABLE", "RESERVED", "CLEANING", "OUT_OF_SERVICE"]),
  reason: optionalText(300),
}).refine((v) => !bedStatusRequiresReason(v.status) || (v.reason && v.reason.length >= 3), { path: ["reason"], message: "A reason is required to take a bed out of service" });

/** Parse "A-01, A-02\nA-03" into a clean label list. */
export function parseBedLabels(text) {
  return String(text || "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

/** Next sequential labels for a ward ("GMW-11", "GMW-12", …) given existing labels. */
export function nextBedLabels(code, existing, count) {
  const re = new RegExp(`^${code.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}-(\\d+)$`, "i");
  let max = 0;
  for (const l of existing) { const m = re.exec(l); if (m) max = Math.max(max, Number(m[1])); }
  return Array.from({ length: count }, (_, i) => `${code}-${String(max + i + 1).padStart(2, "0")}`);
}

/** Occupancy figures for a list of beds (out-of-service beds are excluded from the denominator). */
export function occupancyStats(beds) {
  const counts = Object.fromEntries(BED_STATUSES.map((s) => [s, 0]));
  for (const b of beds) counts[b.status] = (counts[b.status] || 0) + 1;
  const total = beds.length;
  const inService = total - counts.OUT_OF_SERVICE;
  const occupancyPct = inService > 0 ? Math.round((counts.OCCUPIED / inService) * 100) : 0;
  return { total, inService, ...counts, occupancyPct };
}

// ───────────────────────────── Admissions ─────────────────────────────

/**
 * Length of stay in days, counted as calendar midnights crossed in the hospital
 * time zone, with a minimum of 1 (same-day admissions count as one day).
 * `hours` is the elapsed time for display.
 */
export function lengthOfStay(admittedAt, endAt, tz = "Asia/Karachi") {
  const start = new Date(admittedAt);
  const end = endAt ? new Date(endAt) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return { days: 1, hours: 0, midnights: 0 };
  const d1 = toZonedDateString(start, tz), d2 = toZonedDateString(end, tz);
  const midnights = Math.round((Date.parse(`${d2}T00:00:00Z`) - Date.parse(`${d1}T00:00:00Z`)) / 86400000);
  return { days: Math.max(1, midnights), hours: Math.floor((end - start) / 3600000), midnights };
}

export function formatLos(admittedAt, endAt, tz) {
  const { days, hours } = lengthOfStay(admittedAt, endAt, tz);
  if (hours < 24) return `${hours} h (day ${days})`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export const ADMISSION_STATUSES = ["ADMITTED", "DISCHARGED", "TRANSFERRED_OUT", "CANCELLED"];
export const DISCHARGE_CONDITIONS = [
  "Recovered", "Improved", "Stable", "Unchanged", "Deteriorated", "Referred to another facility", "Left against medical advice",
];

export const admissionSchema = z.object({
  patientId: id,
  doctorId: z.string({ error: "Choose the admitting doctor" }).min(1, "Choose the admitting doctor").max(64),
  wardId: z.string({ error: "Choose a ward" }).min(1, "Choose a ward").max(64),
  bedId: z.string({ error: "Choose a bed" }).min(1, "Choose a bed").max(64),
  reason: requiredText(500, "Reason for admission"),
  expectedDischargeDate: optionalDate,
});

export const transferSchema = z.object({
  wardId: z.string().max(64).optional(),
  bedId: z.string({ error: "Choose the new bed" }).min(1, "Choose the new bed").max(64),
  reason: requiredText(300, "Reason for transfer"),
});

const timeHHMM = z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional());

export const dischargeSchema = z.object({
  dischargeSummary: z.string({ error: "Discharge summary is required" }).trim().min(10, "Write a discharge summary (min 10 characters)").max(10000),
  dischargeCondition: z.enum(DISCHARGE_CONDITIONS, { error: "Choose the condition at discharge" }),
  dischargeDate: optionalDate,
  dischargeTime: timeHHMM,
})
  .refine((v) => !v.dischargeTime || v.dischargeDate, { path: ["dischargeDate"], message: "Enter the date as well" })
  .refine((v) => !v.dischargeDate || v.dischargeTime, { path: ["dischargeTime"], message: "Enter the time as well" });

const optNum = (min, max, label, int = true) => z.preprocess(
  (v) => (v === "" || v == null ? undefined : Number(v)),
  (int ? z.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`) : z.number({ error: `${label} must be a number` }))
    .min(min, `${label} must be ≥ ${min}`).max(max, `${label} must be ≤ ${max}`).optional(),
);

export const vitalsSchema = z.object({
  temperatureC: optNum(30, 45, "Temperature", false),
  pulse: optNum(20, 250, "Pulse"),
  respRate: optNum(4, 80, "Respiratory rate"),
  systolic: optNum(50, 260, "Systolic BP"),
  diastolic: optNum(20, 180, "Diastolic BP"),
  spo2: optNum(50, 100, "SpO₂"),
  weightKg: optNum(0.3, 400, "Weight", false),
  heightCm: optNum(20, 250, "Height", false),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { path: ["_"], message: "Enter at least one measurement" })
  .refine((v) => (v.systolic === undefined) === (v.diastolic === undefined), { path: ["diastolic"], message: "Enter both systolic and diastolic" })
  .refine((v) => v.systolic === undefined || v.diastolic === undefined || v.systolic > v.diastolic, { path: ["diastolic"], message: "Diastolic must be lower than systolic" });

export const ADMISSION_NOTE_KINDS = ["PROGRESS", "ROUND", "NURSING"];
export const noteSchema = z.object({
  kind: z.enum(ADMISSION_NOTE_KINDS),
  content: z.string({ error: "Note is required" }).trim().min(2, "Note is required").max(5000),
});

export const MAR_STATUSES = ["GIVEN", "HELD", "REFUSED"];
export const marSchema = z.object({
  prescriptionItemId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  medicationName: optionalText(160),
  dose: requiredText(80, "Dose"),
  status: z.enum(MAR_STATUSES),
  note: optionalText(500),
})
  .refine((v) => v.prescriptionItemId || v.medicationName, { path: ["medicationName"], message: "Pick a prescribed item or enter the medication" })
  .refine((v) => v.status === "GIVEN" || (v.note && v.note.length >= 3), { path: ["note"], message: "Record why the dose was held or refused" });

export const admissionListQuery = z.object({
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum([...ADMISSION_STATUSES, "ALL"]).optional()),
  wardId: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(64).optional()),
});

// ───────────────────────────── Display helpers ─────────────────────────────

export const doctorName = (d) => (d?.staff ? `Dr. ${d.staff.firstName} ${d.staff.lastName}` : "—");
export const patientName = (p) => (p ? `${p.firstName} ${p.lastName}` : "—");
export const titleCase = (s) => String(s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
