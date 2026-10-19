import { z } from "zod";
import { id, optionalText, requiredText } from "./common.js";

export const ROUTES = ["Oral", "Sublingual", "Topical", "Inhaled", "Intravenous", "Intramuscular", "Subcutaneous", "Rectal", "Ophthalmic", "Otic", "Nasal"];
export const FREQUENCIES = ["Once daily", "Twice daily", "Three times daily", "Four times daily", "Every 8 hours", "Every 6 hours", "At bedtime", "As needed", "Once"];

export const prescriptionItemSchema = z.object({
  medicationId: id.refine((v) => v.length > 0, "Choose a medicine"),
  dose: requiredText(60, "Dose"),
  route: requiredText(40, "Route"),
  frequency: requiredText(60, "Frequency"),
  durationDays: z.coerce.number({ error: "Duration is required" }).int("Whole days only").min(1, "At least 1 day").max(365, "Max 365 days"),
  quantity: z.coerce.number({ error: "Quantity is required" }).int("Whole units only").min(1, "At least 1").max(10000, "Too large"),
  instructions: optionalText(300),
});

const items = z.array(prescriptionItemSchema).min(1, "Add at least one medicine").max(20, "Max 20 medicines per prescription")
  .refine((arr) => new Set(arr.map((i) => i.medicationId)).size === arr.length, "Each medicine can only be listed once");

export const prescriptionCreateSchema = z.object({
  patientId: id,
  encounterId: z.preprocess((v) => (v === "" || v == null ? undefined : v), id.optional()),
  items,
  notes: optionalText(1000),
  finalize: z.boolean().optional().default(false),
  acknowledgeAllergies: z.boolean().optional().default(false),
});

export const prescriptionUpdateSchema = z.object({
  items: items.optional(),
  notes: optionalText(1000),
  finalize: z.boolean().optional().default(false),
  acknowledgeAllergies: z.boolean().optional().default(false),
});

export const prescriptionCancelSchema = z.object({ reason: requiredText(300, "Reason").refine((v) => v.length >= 3, "Please give a reason (min 3 characters)") });

// ───────────── Allergy name match ─────────────
export const ALLERGY_CHECK_LABEL = "Basic name match against recorded allergies — not a drug-interaction or clinical decision-support check";

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const MATCH_FIELDS = ["genericName", "brandName", "category"];

/**
 * Case-insensitive name match of each active allergy's substance against a medicine's
 * generic name, brand name and category. A match is when either string contains the other
 * (both at least 3 characters). This is a simple text comparison, not a clinical check.
 * @param {{id?:string, substance:string, severity?:string, reaction?:string, isActive?:boolean}[]} allergies
 * @param {{id:string, genericName?:string, brandName?:string|null, category?:string|null}[]} medications
 * @returns {{ allergyId?:string, substance:string, severity?:string, medicationId:string, medicationName:string, matchedOn:string }[]}
 */
export function matchAllergies(allergies, medications) {
  const out = [];
  for (const a of allergies || []) {
    if (a.isActive === false) continue;
    const s = norm(a.substance);
    if (s.length < 3) continue;
    for (const m of medications || []) {
      for (const f of MATCH_FIELDS) {
        const v = norm(m[f]);
        if (v.length < 3) continue;
        if (v.includes(s) || s.includes(v)) {
          out.push({ allergyId: a.id, substance: a.substance, severity: a.severity, medicationId: m.id, medicationName: [m.genericName, m.brandName && `(${m.brandName})`].filter(Boolean).join(" "), matchedOn: f });
          break;
        }
      }
    }
  }
  return out;
}
