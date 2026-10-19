import { z } from "zod";
import { requiredText, optionalText, phone, email, timeString, optionalDate } from "./common.js";

// Settings are validated on the client (forms) and again on the server (API).

export const PAYMENT_METHODS = ["CASH", "CARD", "BANK_TRANSFER", "ONLINE"];
export const PAYMENT_METHOD_LABELS = { CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Bank transfer", ONLINE: "Online" };

/** IANA time zones known to the runtime (plus "UTC", which some engines omit from the list). */
export function supportedTimeZones() {
  try {
    const list = Intl.supportedValuesOf("timeZone");
    return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    return ["UTC", "Asia/Karachi"];
  }
}

export function isValidTimeZone(tz) {
  return typeof tz === "string" && supportedTimeZones().includes(tz);
}

export function isValidLocale(tag) {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

export function isValidCurrency(code) {
  if (!/^[A-Z]{3}$/.test(code || "")) return false;
  try {
    if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("currency").includes(code);
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

export const hospitalSettingsSchema = z.object({
  name: requiredText(120, "Hospital name"),
  address: optionalText(300),
  phone,
  email,
  timezone: z.string().trim().refine(isValidTimeZone, "Choose a valid IANA time zone (e.g. Asia/Karachi)"),
  currency: z.string().trim().toUpperCase().refine(isValidCurrency, "Use a 3-letter ISO 4217 currency code (e.g. PKR)"),
  locale: z.string().trim().min(2, "Locale is required").max(35).refine(isValidLocale, "Use a valid BCP 47 locale (e.g. en-PK)"),
});

export const appointmentPolicySchema = z.object({
  workdayStart: timeString,
  workdayEnd: timeString,
  defaultSlotMinutes: z.coerce.number({ error: "Enter minutes" }).int("Whole minutes only").min(5, "At least 5 minutes").max(120, "At most 120 minutes"),
  allowPatientRequests: z.boolean(),
  minCancelHours: z.coerce.number({ error: "Enter hours" }).int("Whole hours only").min(0, "Cannot be negative").max(168, "At most 168 hours (7 days)"),
}).refine((v) => v.workdayStart < v.workdayEnd, { path: ["workdayEnd"], message: "Workday must end after it starts" });

export const billingSettingsSchema = z.object({
  taxRatePercent: z.union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) >= 0 && Number(v) <= 100, "Enter a percentage between 0 and 100 (max 2 decimals)"),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1, "Enable at least one payment method")
    .refine((a) => new Set(a).size === a.length, "Duplicate payment method"),
  maxDiscountPercentWithoutApproval: z.coerce.number({ error: "Enter a percentage" }).int("Whole percent only").min(0).max(100),
});

export const pharmacySettingsSchema = z.object({
  expiryAlertDays: z.coerce.number({ error: "Enter days" }).int("Whole days only").min(1, "At least 1 day").max(730, "At most 730 days"),
});

export const labSettingsSchema = z.object({
  requireSecondValidator: z.boolean(),
});

const triageCategory = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,19}$/, "Use capitals, digits or _ (max 20)"),
  label: requiredText(40, "Label"),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #dc2626"),
});

export const emergencySettingsSchema = z.object({
  triageCategories: z.array(triageCategory).min(1, "Keep at least one triage category").max(10, "At most 10 categories")
    .superRefine((list, ctx) => {
      const seen = new Set();
      list.forEach((c, i) => {
        if (seen.has(c.key)) ctx.addIssue({ code: "custom", path: [i, "key"], message: "Duplicate key" });
        seen.add(c.key);
      });
    }),
});

/** Editable SystemSetting keys and their schemas (the hospital profile updates the Hospital row instead). */
export const SETTING_SCHEMAS = {
  appointments: appointmentPolicySchema,
  billing: billingSettingsSchema,
  pharmacy: pharmacySettingsSchema,
  lab: labSettingsSchema,
  emergency: emergencySettingsSchema,
};

export const LAB_SETTING_DEFAULTS = { requireSecondValidator: false };

export const auditQuerySchema = z.object({
  user: z.string().trim().max(100).optional().default(""),
  action: z.string().trim().max(60).regex(/^[a-z0-9_.:-]*$/i, "Letters, digits and . _ - : only").optional().default(""),
  entityType: z.string().trim().max(60).optional().default(""),
  entityId: z.string().trim().max(64).optional().default(""),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(10).max(100).optional().default(25),
});
