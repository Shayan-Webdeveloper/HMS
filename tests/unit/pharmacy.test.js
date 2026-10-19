import { describe, it, expect } from "vitest";
import {
  allocateFefo, classifyExpiry, isBatchUsable, computePrescriptionStatus, stockLevel, daysUntil, netDispensedByBatch,
  dispenseSchema, receiveBatchSchema, medicationSchema, DISPENSABLE_STATUSES, RETURNABLE_STATUSES,
} from "@/lib/validation/pharmacy";
import { calcPoTotal, calcPoLine, calcStockValue, canTransitionPo, PO_TRANSITIONS, purchaseOrderSchema, poStatusSchema, itemStockLevel } from "@/lib/validation/inventory";

const TODAY = "2026-10-09";
const b = (id, expiry, quantity, receivedAt) => ({ id, expiryDate: new Date(`${expiry}T00:00:00Z`), quantity, receivedAt });

describe("FEFO allocation", () => {
  it("takes the earliest-expiring batch first and spills into the next", () => {
    const r = allocateFefo([b("late", "2027-06-01", 50), b("early", "2026-12-01", 10), b("mid", "2027-01-15", 20)], 25, TODAY);
    expect(r.ok).toBe(true);
    expect(r.allocations).toEqual([{ batchId: "early", quantity: 10 }, { batchId: "mid", quantity: 15 }]);
    expect(r.available).toBe(80);
  });
  it("never allocates from expired batches (expiry on or before today)", () => {
    const r = allocateFefo([b("expired", "2026-10-01", 100), b("today", TODAY, 100), b("ok", "2026-10-10", 5)], 5, TODAY);
    expect(r.allocations).toEqual([{ batchId: "ok", quantity: 5 }]);
  });
  it("reports insufficient stock without partial allocations", () => {
    const r = allocateFefo([b("expired", "2026-01-01", 500), b("a", "2027-01-01", 3), b("c", "2027-02-01", 4)], 8, TODAY);
    expect(r).toEqual({ ok: false, requested: 8, available: 7, allocations: [] });
  });
  it("skips empty batches and accepts string expiry dates", () => {
    const r = allocateFefo([{ id: "x", expiryDate: "2026-11-01", quantity: 0 }, { id: "y", expiryDate: "2026-12-01", quantity: 2 }], 2, TODAY);
    expect(r.allocations).toEqual([{ batchId: "y", quantity: 2 }]);
  });
  it("breaks expiry ties by receipt date, then id (deterministic lock order)", () => {
    const r = allocateFefo([b("b2", "2027-01-01", 5, "2026-09-02T00:00:00Z"), b("b1", "2027-01-01", 5, "2026-09-01T00:00:00Z")], 6, TODAY);
    expect(r.allocations).toEqual([{ batchId: "b1", quantity: 5 }, { batchId: "b2", quantity: 1 }]);
    const s = allocateFefo([b("z", "2027-01-01", 5), b("a", "2027-01-01", 5)], 1, TODAY);
    expect(s.allocations).toEqual([{ batchId: "a", quantity: 1 }]);
  });
  it("allocates exactly the available amount when it matches the request", () => {
    expect(allocateFefo([b("a", "2027-01-01", 4), b("b", "2027-03-01", 6)], 10, TODAY).allocations).toEqual([{ batchId: "a", quantity: 4 }, { batchId: "b", quantity: 6 }]);
  });
  it("rejects non-positive or fractional quantities", () => {
    expect(() => allocateFefo([], 0, TODAY)).toThrow();
    expect(() => allocateFefo([], 1.5, TODAY)).toThrow();
  });
  it("does not mutate the input batches", () => {
    const list = [b("a", "2027-01-01", 4)];
    allocateFefo(list, 2, TODAY);
    expect(list[0].quantity).toBe(4);
  });
});

describe("expiry classification", () => {
  it("classifies expired / expiring / ok against the alert window", () => {
    expect(classifyExpiry("2026-10-08", TODAY, 90)).toBe("EXPIRED");
    expect(classifyExpiry(TODAY, TODAY, 90)).toBe("EXPIRED");
    expect(classifyExpiry("2026-10-10", TODAY, 90)).toBe("EXPIRING");
    expect(classifyExpiry("2027-01-07", TODAY, 90)).toBe("EXPIRING"); // exactly +90 days
    expect(classifyExpiry("2027-01-08", TODAY, 90)).toBe("OK");
    expect(classifyExpiry(new Date("2027-06-01T00:00:00Z"), TODAY, 90)).toBe("OK");
  });
  it("honours a zero-day window", () => {
    expect(classifyExpiry("2026-10-10", TODAY, 0)).toBe("OK");
  });
  it("usable means strictly after today", () => {
    expect(isBatchUsable("2026-10-10", TODAY)).toBe(true);
    expect(isBatchUsable(TODAY, TODAY)).toBe(false);
  });
  it("counts days until expiry", () => {
    expect(daysUntil("2026-10-19", TODAY)).toBe(10);
    expect(daysUntil("2026-10-01", TODAY)).toBe(-8);
  });
});

describe("prescription status & stock helpers", () => {
  it("derives status from dispensed quantities", () => {
    expect(computePrescriptionStatus([{ quantity: 10, dispensedQty: 0 }, { quantity: 5, dispensedQty: 0 }])).toBe("ACTIVE");
    expect(computePrescriptionStatus([{ quantity: 10, dispensedQty: 4 }, { quantity: 5, dispensedQty: 0 }])).toBe("PARTIALLY_DISPENSED");
    expect(computePrescriptionStatus([{ quantity: 10, dispensedQty: 10 }, { quantity: 5, dispensedQty: 5 }])).toBe("DISPENSED");
    expect(computePrescriptionStatus([{ quantity: 10, dispensedQty: 10 }, { quantity: 5, dispensedQty: 0 }])).toBe("PARTIALLY_DISPENSED");
  });
  it("only ACTIVE / PARTIALLY_DISPENSED are dispensable; DRAFT and CANCELLED never", () => {
    expect(DISPENSABLE_STATUSES).toEqual(["ACTIVE", "PARTIALLY_DISPENSED"]);
    for (const s of ["DRAFT", "CANCELLED", "DISPENSED"]) expect(DISPENSABLE_STATUSES).not.toContain(s);
    expect(RETURNABLE_STATUSES).not.toContain("DRAFT");
    expect(RETURNABLE_STATUSES).not.toContain("CANCELLED");
  });
  it("computes net dispensed per batch from the ledger", () => {
    const m = netDispensedByBatch([
      { type: "DISPENSE", batchId: "a", quantity: -6 }, { type: "DISPENSE", batchId: "b", quantity: -4 },
      { type: "RETURN", batchId: "a", quantity: 2 }, { type: "ADJUSTMENT", batchId: "a", quantity: -100 },
    ]);
    expect(m.get("a")).toBe(4);
    expect(m.get("b")).toBe(4);
  });
  it("stock level labels", () => {
    expect(stockLevel(0, 10)).toBe("OUT");
    expect(stockLevel(10, 10)).toBe("LOW");
    expect(stockLevel(11, 10)).toBe("OK");
    expect(itemStockLevel(5, 10)).toBe("LOW");
  });
});

describe("pharmacy validation", () => {
  it("requires at least one positive dispense quantity and unique items", () => {
    expect(dispenseSchema.safeParse({ items: [{ itemId: "a", quantity: 0 }] }).success).toBe(false);
    expect(dispenseSchema.safeParse({ items: [{ itemId: "a", quantity: 2 }, { itemId: "a", quantity: 1 }] }).success).toBe(false);
    expect(dispenseSchema.safeParse({ items: [{ itemId: "a", quantity: "3" }, { itemId: "b", quantity: 0 }] }).data.items[0].quantity).toBe(3);
    expect(dispenseSchema.safeParse({ items: [{ itemId: "a", quantity: -1 }] }).success).toBe(false);
  });
  it("validates batch receipts", () => {
    expect(receiveBatchSchema.safeParse({ batchNo: "B-1", expiryDate: "2027-01-01", quantity: "10", purchaseCost: "2.50" }).success).toBe(true);
    expect(receiveBatchSchema.safeParse({ batchNo: "B-1", expiryDate: "2027-01-01", quantity: 0, purchaseCost: "2.50" }).success).toBe(false);
    expect(receiveBatchSchema.safeParse({ batchNo: "B-1", expiryDate: "2027-01-01", quantity: 5, purchaseCost: "2.555" }).success).toBe(false);
  });
  it("normalises medication codes to upper case", () => {
    const r = medicationSchema.parse({ code: " pcm500 ", genericName: "Paracetamol", strength: "500 mg", dosageForm: "TABLET", unit: "tablet", sellingPrice: "4", reorderLevel: "50" });
    expect(r.code).toBe("PCM500");
    expect(r.reorderLevel).toBe(50);
  });
});

describe("purchase orders", () => {
  it("totals lines with Decimal math (no float drift)", () => {
    expect(calcPoTotal([{ quantity: 3, unitCost: "0.10" }])).toBe("0.30");
    expect(calcPoTotal([{ quantity: 600, unitCost: "18.00" }, { quantity: 40, unitCost: "950.00" }, { quantity: 7, unitCost: "65.35" }])).toBe("49257.45");
    expect(calcPoTotal([])).toBe("0.00");
    expect(calcPoLine({ quantity: 3, unitCost: "33.33" })).toBe("99.99");
  });
  it("values stock as quantity × unit cost", () => {
    expect(calcStockValue([{ quantity: 40, unitCost: "950.00" }, { quantity: 600, unitCost: "18.00" }])).toBe("48800.00");
  });
  it("allows only the defined status transitions", () => {
    expect(canTransitionPo("DRAFT", "ORDERED")).toBe(true);
    expect(canTransitionPo("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransitionPo("ORDERED", "RECEIVED")).toBe(true);
    expect(canTransitionPo("ORDERED", "CANCELLED")).toBe(true);
    expect(canTransitionPo("DRAFT", "RECEIVED")).toBe(false);
    expect(canTransitionPo("RECEIVED", "CANCELLED")).toBe(false);
    expect(canTransitionPo("CANCELLED", "ORDERED")).toBe(false);
    expect(canTransitionPo("RECEIVED", "RECEIVED")).toBe(false);
    expect(PO_TRANSITIONS.RECEIVED).toEqual([]);
    expect(PO_TRANSITIONS.CANCELLED).toEqual([]);
  });
  it("rejects duplicate item lines and requires a reason to cancel", () => {
    const line = { inventoryItemId: "i1", quantity: 1, unitCost: "1.00" };
    expect(purchaseOrderSchema.safeParse({ supplierId: "s", items: [line, line] }).success).toBe(false);
    expect(purchaseOrderSchema.safeParse({ supplierId: "s", items: [] }).success).toBe(false);
    expect(purchaseOrderSchema.safeParse({ supplierId: "s", items: [line] }).success).toBe(true);
    expect(poStatusSchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
    expect(poStatusSchema.safeParse({ status: "CANCELLED", reason: "Supplier out of stock" }).success).toBe(true);
    expect(poStatusSchema.safeParse({ status: "RECEIVED" }).success).toBe(true);
  });
});

describe("lenient search-param parsing", () => {
  it("drops only invalid fields and falls back to page defaults", async () => {
    const { parseLenient, stockQuery } = await import("@/lib/validation/pharmacy");
    const r = parseLenient(stockQuery, { page: "abc", dir: "sideways", q: "para", status: "low" }, { sort: "name", dir: "asc" });
    expect(r).toMatchObject({ page: 1, dir: "asc", q: "para", status: "low", sort: "name" });
    const s = parseLenient(stockQuery, { dir: "desc", sort: "onHand" }, { sort: "name", dir: "asc" });
    expect(s).toMatchObject({ dir: "desc", sort: "onHand" });
  });
});
