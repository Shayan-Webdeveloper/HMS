import { z } from "zod";
import { id, requiredText, optionalText, dateString, money, listQuery } from "./common.js";
import { addDays } from "../utils/time.js";

// ───────────────────────────── Constants ─────────────────────────────

export const DOSAGE_FORMS = [
  "TABLET", "CAPSULE", "SYRUP", "SUSPENSION", "INJECTION", "INFUSION", "INHALER", "SACHET",
  "CREAM", "OINTMENT", "GEL", "DROPS", "SUPPOSITORY", "PATCH", "POWDER", "OTHER",
];

/** Movement types that apply to medication stock. */
export const MED_MOVEMENT_TYPES = ["RECEIPT", "DISPENSE", "RETURN", "ADJUSTMENT", "EXPIRED"];

/** Stock-tab filters (deep-linkable: /pharmacy?tab=stock&status=low). */
export const STOCK_FILTERS = [
  { value: "low", label: "Low stock (≤ reorder level)" },
  { value: "out", label: "Out of stock" },
  { value: "expiring", label: "Expiring soon" },
  { value: "expired", label: "Expired on shelf" },
];

/** Prescriptions that can be dispensed against. DRAFT and CANCELLED never can. */
export const DISPENSABLE_STATUSES = ["ACTIVE", "PARTIALLY_DISPENSED"];
/** Prescriptions that can accept returns of dispensed items. */
export const RETURNABLE_STATUSES = ["PARTIALLY_DISPENSED", "DISPENSED"];
/** Statuses the pharmacy queue may show (drafts belong to the prescriber). */
export const QUEUE_STATUSES = ["ACTIVE", "PARTIALLY_DISPENSED", "DISPENSED", "CANCELLED"];

export const humanize = (s) => String(s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// ───────────────────────────── Pure stock logic ─────────────────────────────

/** "YYYY-MM-DD" from a Date (UTC — @db.Date columns are UTC midnight) or a date string. */
export function toDateKey(d) {
  if (d == null) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * A batch is usable only while its expiry date is strictly after today (hospital time zone).
 * A batch whose expiry date is today counts as expired — the conservative choice.
 */
export function isBatchUsable(expiryDate, today) {
  return toDateKey(expiryDate) > today;
}

/**
 * Classify a batch expiry against today and the configured alert window.
 * @returns "EXPIRED" | "EXPIRING" | "OK"
 */
export function classifyExpiry(expiryDate, today, alertDays = 90) {
  const key = toDateKey(expiryDate);
  if (key <= today) return "EXPIRED";
  if (key <= addDays(today, Number(alertDays) || 0)) return "EXPIRING";
  return "OK";
}

/** Days from today until expiry (negative when already expired). */
export function daysUntil(expiryDate, today) {
  const a = Date.parse(`${toDateKey(expiryDate)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

/**
 * First-expiry-first-out allocation across NON-EXPIRED batches.
 * @param {{id:string, expiryDate:Date|string, quantity:number, receivedAt?:Date|string}[]} batches
 * @param {number} qty requested quantity (positive integer)
 * @param {string} today "YYYY-MM-DD" in the hospital time zone
 * @returns {{ ok:boolean, requested:number, available:number, allocations:{batchId:string, quantity:number}[] }}
 */
export function allocateFefo(batches, qty, today) {
  const requested = Number(qty);
  if (!Number.isInteger(requested) || requested <= 0) throw new Error("Quantity must be a positive whole number");
  const usable = (batches || [])
    .filter((b) => Number(b.quantity) > 0 && isBatchUsable(b.expiryDate, today))
    .sort((a, b) => {
      const ea = toDateKey(a.expiryDate), eb = toDateKey(b.expiryDate);
      if (ea !== eb) return ea < eb ? -1 : 1;
      const ra = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const rb = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      if (ra !== rb) return ra - rb;
      return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
    });
  const available = usable.reduce((s, b) => s + Number(b.quantity), 0);
  if (available < requested) return { ok: false, requested, available, allocations: [] };
  const allocations = [];
  let left = requested;
  for (const b of usable) {
    if (left === 0) break;
    const take = Math.min(left, Number(b.quantity));
    allocations.push({ batchId: b.id, quantity: take });
    left -= take;
  }
  return { ok: true, requested, available, allocations };
}

/** Prescription status implied by its items' dispensed quantities. */
export function computePrescriptionStatus(items) {
  if (!items?.length) return "ACTIVE";
  if (items.every((i) => i.dispensedQty >= i.quantity)) return "DISPENSED";
  if (items.some((i) => i.dispensedQty > 0)) return "PARTIALLY_DISPENSED";
  return "ACTIVE";
}

/** Stock level label for a medication's usable on-hand vs. reorder level. */
export function stockLevel(onHand, reorderLevel) {
  if (onHand <= 0) return "OUT";
  if (onHand <= reorderLevel) return "LOW";
  return "OK";
}

/**
 * Net quantity dispensed per batch for one prescription item, from its ledger rows
 * (DISPENSE rows are negative, RETURN rows positive).
 * @returns {Map<string, number>}
 */
export function netDispensedByBatch(movements) {
  const m = new Map();
  for (const mv of movements || []) {
    if (!mv.batchId || !["DISPENSE", "RETURN"].includes(mv.type)) continue;
    m.set(mv.batchId, (m.get(mv.batchId) || 0) - Number(mv.quantity));
  }
  return m;
}

// ───────────────────────────── Schemas ─────────────────────────────

const wholeNumber = (label, min, max = 1_000_000) =>
  z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} is too large`);

const optionalId = z.preprocess((v) => (v === "" || v == null ? undefined : v), id.optional());

export const medicationSchema = z.object({
  code: z.string({ error: "Code is required" }).trim().toUpperCase().min(2, "Code must be at least 2 characters").max(30, "Code is too long")
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, "Use letters, digits, dot, dash or underscore"),
  genericName: requiredText(120, "Generic name"),
  brandName: optionalText(120),
  strength: requiredText(60, "Strength"),
  dosageForm: z.enum(DOSAGE_FORMS, { error: "Choose a dosage form" }),
  category: optionalText(80),
  manufacturer: optionalText(120),
  unit: requiredText(30, "Unit"),
  sellingPrice: money,
  reorderLevel: wholeNumber("Reorder level", 0),
  isActive: z.boolean().optional().default(true),
});

export const activeToggleSchema = z.object({
  isActive: z.boolean(),
  reason: optionalText(300),
});

export const receiveBatchSchema = z.object({
  medicationId: optionalId,
  batchNo: z.string({ error: "Batch number is required" }).trim().min(1, "Batch number is required").max(40, "Batch number is too long")
    .regex(/^[A-Za-z0-9][A-Za-z0-9./_-]*$/, "Use letters, digits, dot, slash, dash or underscore"),
  expiryDate: dateString,
  quantity: wholeNumber("Quantity", 1),
  purchaseCost: money,
  supplierId: optionalId,
});

const reason = z.string({ error: "Reason is required" }).trim().min(3, "Give a reason (min 3 characters)").max(300);

export const batchAdjustSchema = z.object({
  direction: z.enum(["IN", "OUT"], { error: "Choose increase or decrease" }),
  quantity: wholeNumber("Quantity", 1),
  reason,
});

export const writeOffSchema = z.object({
  quantity: z.preprocess((v) => (v === "" || v == null ? undefined : v), wholeNumber("Quantity", 1).optional()),
  reason,
});

export const dispenseSchema = z.object({
  items: z.array(z.object({ itemId: id, quantity: wholeNumber("Quantity", 0, 100_000) }))
    .min(1, "Nothing to dispense").max(50)
    .refine((a) => a.some((i) => i.quantity > 0), "Enter a quantity for at least one item")
    .refine((a) => new Set(a.map((i) => i.itemId)).size === a.length, "Each item may appear only once"),
});

export const returnSchema = z.object({
  itemId: id,
  batchId: z.string({ error: "Choose a batch" }).min(1, "Choose a batch").max(64),
  quantity: wholeNumber("Quantity", 1, 100_000),
  reason,
});

// ───────────────────────────── Query schemas ─────────────────────────────

/**
 * Parse URL search params leniently: any field that fails validation is dropped (falls back to its
 * default) instead of failing the whole page. `extra` supplies page-specific defaults.
 */
export function parseLenient(schema, sp, extra = {}) {
  let input = { ...extra, ...Object.fromEntries(Object.entries(sp || {}).filter(([, v]) => v !== undefined && v !== "")) };
  for (let i = 0; i < 8; i++) {
    const r = schema.safeParse(input);
    if (r.success) return r.data;
    const bad = new Set(r.error.issues.map((x) => String(x.path[0])));
    const next = Object.fromEntries(Object.entries(input).filter(([k]) => !bad.has(k)));
    // Re-apply page defaults for dropped keys when the default itself is valid.
    for (const k of bad) if (k in extra && input[k] !== extra[k]) next[k] = extra[k];
    input = next;
  }
  return schema.parse({});
}

export const medicationLookupQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
  includeInactive: z.preprocess((v) => v === "1" || v === "true" || v === true, z.boolean()).optional().default(false),
});

export const stockQuery = listQuery.extend({
  category: z.string().trim().max(80).optional(),
});

export const catalogueQuery = listQuery.extend({
  form: z.preprocess((v) => (v === "" ? undefined : v), z.enum(DOSAGE_FORMS).optional()),
});

export const medLedgerQuery = listQuery.extend({
  medicationId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  type: z.preprocess((v) => (v === "" ? undefined : v), z.enum(MED_MOVEMENT_TYPES).optional()),
});
