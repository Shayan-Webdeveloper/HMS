import { z } from "zod";
import { id, requiredText, optionalText, phone, email, money, listQuery } from "./common.js";
import { D, toMoneyString } from "../utils/money.js";

// ───────────────────────────── Constants ─────────────────────────────

export const ITEM_CATEGORIES = ["CONSUMABLE", "EQUIPMENT", "SUPPLY"];
export const INV_MOVEMENT_TYPES = ["RECEIPT", "ISSUE", "ADJUSTMENT"];
export const PO_STATUSES = ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"];

/** Allowed purchase-order status transitions. Terminal states have no exits. */
export const PO_TRANSITIONS = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransitionPo(from, to) {
  return (PO_TRANSITIONS[from] || []).includes(to);
}

export const humanize = (s) => String(s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

// ───────────────────────────── Pure money logic ─────────────────────────────

/** quantity × unitCost as a 2dp string (Decimal math, never floats). */
export function calcPoLine({ quantity, unitCost }) {
  return toMoneyString(D(unitCost).mul(Number(quantity) || 0));
}

/** Purchase-order total = Σ quantity × unitCost (2dp string). */
export function calcPoTotal(lines) {
  let t = D(0);
  for (const l of lines || []) t = t.plus(D(l.unitCost).mul(Number(l.quantity) || 0));
  return toMoneyString(t);
}

/** Stock valuation of a set of items: Σ quantity × unitCost (2dp string). */
export function calcStockValue(items) {
  let t = D(0);
  for (const it of items || []) t = t.plus(D(it.unitCost).mul(Number(it.quantity) || 0));
  return toMoneyString(t);
}

export function itemStockLevel(quantity, reorderLevel) {
  if (quantity <= 0) return "OUT";
  if (quantity <= reorderLevel) return "LOW";
  return "OK";
}

// ───────────────────────────── Schemas ─────────────────────────────

const wholeNumber = (label, min, max = 1_000_000) =>
  z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} is too large`);

const reason = z.string({ error: "Reason is required" }).trim().min(3, "Give a reason (min 3 characters)").max(300);

export const itemSchema = z.object({
  code: z.string({ error: "Code is required" }).trim().toUpperCase().min(2, "Code must be at least 2 characters").max(30, "Code is too long")
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, "Use letters, digits, dot, dash or underscore"),
  name: requiredText(160, "Name"),
  category: z.enum(ITEM_CATEGORIES, { error: "Choose a category" }),
  unit: requiredText(30, "Unit"),
  reorderLevel: wholeNumber("Reorder level", 0),
  unitCost: money,
  location: optionalText(120),
  isActive: z.boolean().optional().default(true),
});

export const activeToggleSchema = z.object({ isActive: z.boolean(), reason: optionalText(300) });

export const issueSchema = z.object({
  departmentId: z.string({ error: "Choose a department" }).min(1, "Choose a department").max(64),
  quantity: wholeNumber("Quantity", 1),
  note: optionalText(200),
});

export const itemAdjustSchema = z.object({
  direction: z.enum(["IN", "OUT"], { error: "Choose increase or decrease" }),
  quantity: wholeNumber("Quantity", 1),
  reason,
});

export const supplierSchema = z.object({
  name: requiredText(120, "Supplier name"),
  phone,
  email,
  address: optionalText(300),
});

export const poLineSchema = z.object({
  inventoryItemId: z.string({ error: "Choose an item" }).min(1, "Choose an item").max(64),
  quantity: wholeNumber("Quantity", 1, 100_000),
  unitCost: money,
});

export const purchaseOrderSchema = z.object({
  supplierId: z.string({ error: "Choose a supplier" }).min(1, "Choose a supplier").max(64),
  items: z.array(poLineSchema).min(1, "Add at least one line").max(100, "Too many lines")
    .refine((a) => new Set(a.map((l) => l.inventoryItemId)).size === a.length, "Each item may appear only once — combine duplicate lines"),
});

export const poStatusSchema = z.object({
  status: z.enum(["ORDERED", "RECEIVED", "CANCELLED"]),
  reason: optionalText(300),
}).refine((v) => v.status !== "CANCELLED" || (v.reason && v.reason.length >= 3), { error: "Give a reason for cancelling (min 3 characters)", path: ["reason"] });

// ───────────────────────────── Query schemas ─────────────────────────────

const optionalEnum = (vals) => z.preprocess((v) => (v === "" ? undefined : v), z.enum(vals).optional());

export const itemsQuery = listQuery.extend({ category: optionalEnum(ITEM_CATEGORIES), stock: optionalEnum(["low", "out"]) });
export const poQuery = listQuery.extend({ supplierId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()) });
export const invLedgerQuery = listQuery.extend({
  itemId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  type: optionalEnum(INV_MOVEMENT_TYPES),
});
