import { z } from "zod";
import { id, optionalText, requiredText, optionalDate } from "./common.js";

export const ENCOUNTER_STATUSES = ["DRAFT", "FINALIZED", "CANCELLED"];
export const SOAP_FIELDS = ["chiefComplaint", "historyOfPresentIllness", "examination", "assessment", "plan"];
export const SOAP_LABELS = {
  chiefComplaint: "Chief complaint",
  historyOfPresentIllness: "History of present illness",
  examination: "Examination",
  assessment: "Assessment",
  plan: "Plan",
};

export const encounterCreateSchema = z.object({
  patientId: id,
  appointmentId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  chiefComplaint: optionalText(500),
});

export const encounterUpdateSchema = z.object({
  chiefComplaint: optionalText(500),
  historyOfPresentIllness: optionalText(5000),
  examination: optionalText(5000),
  assessment: optionalText(3000),
  plan: optionalText(5000),
  followUpDate: optionalDate,
});

export const diagnosisSchema = z.object({
  code: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(20).regex(/^[A-Za-z0-9.\-]+$/, "Use letters, digits, dots or dashes").optional()),
  description: requiredText(300, "Description"),
  isPrimary: z.boolean().optional().default(false),
});

export const noteSchema = z.object({
  kind: z.enum(["GENERAL", "PROGRESS"]).default("GENERAL"),
  content: requiredText(5000, "Note"),
});

export const amendSchema = z.object({
  content: requiredText(5000, "Amendment"),
  reason: requiredText(500, "Reason").refine((v) => v.length >= 3, "Please give a reason (min 3 characters)"),
});

// Vital signs: plausibility bounds for data entry only (typo protection) — never interpreted.
const num = (min, max, label, { int = false } = {}) =>
  z.preprocess(
    (v) => (v === "" || v == null || (typeof v === "number" && Number.isNaN(v)) ? undefined : Number(v)),
    (int ? z.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`) : z.number({ error: `${label} must be a number` }))
      .min(min, `${label} must be ${min}–${max}`).max(max, `${label} must be ${min}–${max}`).optional(),
  );

export const VITAL_FIELDS = ["temperatureC", "pulse", "respRate", "systolic", "diastolic", "spo2", "weightKg", "heightCm"];

export const vitalsSchema = z
  .object({
    temperatureC: num(25, 45, "Temperature"),
    pulse: num(20, 250, "Pulse", { int: true }),
    respRate: num(4, 80, "Respiratory rate", { int: true }),
    systolic: num(50, 300, "Systolic BP", { int: true }),
    diastolic: num(20, 200, "Diastolic BP", { int: true }),
    spo2: num(50, 100, "SpO₂", { int: true }),
    weightKg: num(0.5, 400, "Weight"),
    heightCm: num(20, 250, "Height"),
  })
  .refine((v) => VITAL_FIELDS.some((k) => v[k] != null), { message: "Enter at least one measurement", path: ["_"] })
  .refine((v) => v.systolic == null || v.diastolic == null || v.systolic > v.diastolic, { message: "Systolic must be higher than diastolic", path: ["diastolic"] });

export const encounterListQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
  status: z.enum(ENCOUNTER_STATUSES).optional().catch(undefined),
  doctorId: z.string().max(64).optional(),
  patientId: z.string().max(64).optional(),
  from: optionalDate,
  to: optionalDate,
});
