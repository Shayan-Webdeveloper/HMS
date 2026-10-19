import { z } from "zod";
import { D, calcLine, calcInvoiceTotals, toMoneyString } from "../utils/money.js";
import { requiredText, optionalText, money, id, listQuery } from "./common.js";

// ───────────────────────────── Constants ─────────────────────────────

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "VOID", "REFUNDED"];
export const ITEM_CATEGORIES = ["CONSULTATION", "LAB", "IMAGING", "PHARMACY", "PROCEDURE", "BED", "MISC"];
/** Reserved payment method used only by insurance claim settlement. */
export const INSURANCE_METHOD = "INSURANCE";
export const SOURCE_TYPES = ["Encounter", "LabOrderItem", "ImagingStudy", "PrescriptionItem", "BedAssignment", "Procedure"];
export const AGEING_BUCKETS = ["0-30", "31-60", "61-90", "90+"];
const DAY_MS = 86400000;

// ───────────────────────────── Schemas ─────────────────────────────

const positiveMoney = money.refine((v) => D(v).gt(0), "Amount must be greater than zero");
const percent = z.union([z.string(), z.number()]).transform((v) => String(v).trim())
  .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && D(v).lte(100), "Enter a percentage between 0 and 100");

/** A billable source picked from the unbilled-charges list. Prices are always re-derived on the server. */
export const sourceRefSchema = z.object({
  sourceType: z.string().trim().min(1).max(80),
  sourceId: id,
});

export const manualItemSchema = z.object({
  catalogCode: optionalText(40),
  category: z.enum(ITEM_CATEGORIES).default("MISC"),
  description: requiredText(200, "Description"),
  quantity: z.coerce.number({ error: "Enter a quantity" }).int("Whole numbers only").min(1, "Minimum 1").max(10000, "Too large"),
  unitPrice: money,
  taxRate: percent.optional(),
});

const itemsPayload = {
  sources: z.array(sourceRefSchema).max(200).optional().default([]),
  items: z.array(manualItemSchema).max(100).optional().default([]),
};

export const createInvoiceSchema = z.object({ patientId: id, ...itemsPayload })
  .refine((v) => v.sources.length + v.items.length > 0, { message: "Select at least one charge or add an item", path: ["items"] });

export const addItemsSchema = z.object(itemsPayload)
  .refine((v) => v.sources.length + v.items.length > 0, { message: "Select at least one charge or add an item", path: ["items"] });

export const lineUpdateSchema = z.object({
  discount: money.optional(),
  taxRate: percent.optional(),
  reason: optionalText(300),
}).refine((v) => v.discount !== undefined || v.taxRate !== undefined, { message: "Nothing to change", path: ["discount"] })
  .refine((v) => v.discount === undefined || D(v.discount).eq(0) || (v.reason && v.reason.length >= 3), { message: "A discount reason is required", path: ["reason"] });

export const paymentSchema = z.object({
  amount: positiveMoney,
  method: z.string().trim().min(1, "Choose a payment method").max(40),
  reference: optionalText(120),
  idempotencyKey: z.uuid({ error: "Missing or invalid idempotency key" }),
});

export const refundSchema = z.object({
  amount: positiveMoney,
  method: z.string().trim().min(1, "Choose a refund method").max(40),
  reason: z.string({ error: "Reason is required" }).trim().min(3, "Give a reason (min 3 characters)").max(300),
});

export const voidSchema = z.object({
  reason: z.string({ error: "Reason is required" }).trim().min(3, "Give a reason (min 3 characters)").max(300),
});

export const invoiceListQuery = listQuery.extend({
  patientId: z.string().max(64).optional(),
  claimable: z.enum(["1"]).optional(),
});

export const paymentListQuery = listQuery.extend({ method: z.string().max(40).optional() });

// ───────────────────────────── Pure calculation helpers ─────────────────────────────

/** Billable bed days: ceil(elapsed / 24h), minimum 1. */
export function bedDays(startedAt, endedAt = new Date()) {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms)) throw new Error("Invalid dates");
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/**
 * Net quantity dispensed for a prescription item.
 * Stock movements are signed (DISPENSE negative, RETURN positive), so net dispensed = −Σ(quantity).
 * When no DISPENSE ledger rows reference the item (legacy/demo data dispensed outside the ledger, possibly with
 * later RETURN rows) fall back to PrescriptionItem.dispensedQty, which pharmacy keeps net of returns.
 */
export function netDispensedQty(movements, fallbackDispensedQty = 0) {
  const rel = (movements || []).filter((m) => m.type === "DISPENSE" || m.type === "RETURN");
  if (!rel.some((m) => m.type === "DISPENSE")) return Math.max(0, Number(fallbackDispensedQty) || 0);
  const sum = rel.reduce((s, m) => s + Number(m.quantity), 0);
  return Math.max(0, -sum);
}

/** How much of a dispensed quantity is still unbilled; `credit` > 0 means more was billed than is now dispensed (returns after billing). */
export function pharmacyBillableQty(netQty, billedQty) {
  const diff = Number(netQty) - Number(billedQty);
  return { qty: Math.max(0, diff), credit: Math.max(0, -diff) };
}

/** Computes a stored line from user input: returns DB-ready strings. Throws on invalid discount. */
export function buildLine({ quantity, unitPrice, discount = "0", taxRate = "0" }) {
  const l = calcLine({ quantity, unitPrice, discount, taxRate });
  return { quantity, unitPrice: toMoneyString(unitPrice), discount: l.discount, taxRate: D(taxRate).toFixed(2), lineTotal: l.lineTotal };
}

/** Invoice header totals from its lines (server is the only source of truth). */
export function invoiceTotals(items, { amountPaid = 0, amountRefunded = 0 } = {}) {
  return calcInvoiceTotals(items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount ?? 0, taxRate: i.taxRate ?? 0 })), { amountPaid, amountRefunded });
}

/**
 * Status for a non-draft, non-void invoice derived from its money columns.
 * REFUNDED = everything paid has been refunded; PAID = nothing owed; PARTIALLY_PAID = some net payment.
 */
export function deriveInvoiceStatus({ total, amountPaid, amountRefunded }) {
  const paid = D(amountPaid), refunded = D(amountRefunded);
  const net = paid.minus(refunded);
  const balance = D(total).minus(net);
  if (refunded.gt(0) && net.lte(0)) return "REFUNDED";
  if (balance.lte(0)) return "PAID";
  if (net.gt(0)) return "PARTIALLY_PAID";
  return "ISSUED";
}

/** Returns an error message, or null when the payment may be recorded. */
export function paymentGuard(invoice, { amount, method }, allowedMethods = []) {
  const isInsurance = method === INSURANCE_METHOD;
  const openStatuses = isInsurance ? ["ISSUED", "PARTIALLY_PAID", "REFUNDED"] : ["ISSUED", "PARTIALLY_PAID"];
  if (!openStatuses.includes(invoice.status)) {
    return invoice.status === "DRAFT" ? "Issue the invoice before recording payments." : `Payments cannot be recorded on a ${invoice.status.toLowerCase().replace(/_/g, " ")} invoice.`;
  }
  if (!isInsurance && !allowedMethods.includes(method)) return "Payment method is not enabled in billing settings.";
  const amt = D(amount);
  if (amt.lte(0)) return "Amount must be greater than zero.";
  if (amt.gt(D(invoice.balance))) return `Amount exceeds the outstanding balance (${toMoneyString(invoice.balance)}).`;
  return null;
}

export function refundableAmount(invoice) {
  const r = D(invoice.amountPaid).minus(D(invoice.amountRefunded));
  return r.isNegative() ? D(0) : r;
}

export function refundGuard(invoice, { amount, method }, allowedMethods = []) {
  if (!["PARTIALLY_PAID", "PAID"].includes(invoice.status)) return "Only paid or partially paid invoices can be refunded.";
  if (!allowedMethods.includes(method)) return "Refund method is not enabled in billing settings.";
  const amt = D(amount);
  if (amt.lte(0)) return "Amount must be greater than zero.";
  const max = refundableAmount(invoice);
  if (amt.gt(max)) return `Refund exceeds the net amount paid (${toMoneyString(max)}).`;
  return null;
}

export function voidGuard(invoice, { openClaims = 0 } = {}) {
  if (!["DRAFT", "ISSUED"].includes(invoice.status)) return "Only draft or issued invoices without payments can be voided.";
  if (refundableAmount(invoice).gt(0)) return "Refund the payments on this invoice before voiding it.";
  if (openClaims > 0) return "This invoice has insurance claims that are not rejected. Resolve them before voiding.";
  return null;
}

export function issueGuard(invoice, itemCount) {
  if (invoice.status !== "DRAFT") return "Only draft invoices can be issued.";
  if (!itemCount) return "Add at least one item before issuing.";
  if (D(invoice.discountTotal).gt(0) && !invoice.discountReason) return "A discount reason is required before issuing.";
  return null;
}

// ───────────────────────────── Ageing ─────────────────────────────

export function daysSince(date, now = new Date()) {
  return Math.max(0, Math.floor((new Date(now).getTime() - new Date(date).getTime()) / DAY_MS));
}

export function ageingBucket(issuedAt, now = new Date()) {
  const d = daysSince(issuedAt, now);
  if (d <= 30) return "0-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
}

/** Prisma `issuedAt` filter matching ageingBucket() for the given bucket. */
export function ageingRange(bucket, now = new Date()) {
  const t = new Date(now).getTime();
  const at = (days) => new Date(t - days * DAY_MS);
  switch (bucket) {
    case "0-30": return { gt: at(31) };
    case "31-60": return { gt: at(61), lte: at(31) };
    case "61-90": return { gt: at(91), lte: at(61) };
    case "90+": return { lte: at(91) };
    default: return undefined;
  }
}

export const categoryLabel = (c) => (c ? c.charAt(0) + c.slice(1).toLowerCase() : "");
export const methodLabel = (m) => (m || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
