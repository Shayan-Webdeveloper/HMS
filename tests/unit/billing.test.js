import { describe, it, expect } from "vitest";
import {
  bedDays, netDispensedQty, pharmacyBillableQty, buildLine, invoiceTotals, deriveInvoiceStatus,
  paymentGuard, refundGuard, voidGuard, issueGuard, refundableAmount, ageingBucket, ageingRange, daysSince,
  paymentSchema, lineUpdateSchema, createInvoiceSchema,
} from "@/lib/validation/billing";
import {
  canTransitionClaim, resolveClaimDecision, insuranceSettlementAmount, policyCoversDate, claimableRemaining, policySchema,
} from "@/lib/validation/insurance";

const H = 3600000, DAY = 24 * H;
const t0 = new Date("2026-10-01T08:00:00Z");

describe("bed days", () => {
  it("charges a minimum of one day", () => {
    expect(bedDays(t0, new Date(t0.getTime() + 2 * H))).toBe(1);
    expect(bedDays(t0, t0)).toBe(1);
  });
  it("rounds partial days up", () => {
    expect(bedDays(t0, new Date(t0.getTime() + DAY))).toBe(1);
    expect(bedDays(t0, new Date(t0.getTime() + DAY + 1))).toBe(2);
    expect(bedDays(t0, new Date(t0.getTime() + 3 * DAY + 5 * H))).toBe(4);
  });
  it("accepts ISO strings", () => {
    expect(bedDays("2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z")).toBe(2);
  });
});

describe("pharmacy net quantity", () => {
  it("nets DISPENSE (negative) against RETURN (positive) movements", () => {
    expect(netDispensedQty([{ type: "DISPENSE", quantity: -10 }, { type: "RETURN", quantity: 3 }], 10)).toBe(7);
    expect(netDispensedQty([{ type: "DISPENSE", quantity: -4 }, { type: "DISPENSE", quantity: -6 }], 0)).toBe(10);
  });
  it("ignores unrelated movement types", () => {
    expect(netDispensedQty([{ type: "DISPENSE", quantity: -5 }, { type: "ADJUSTMENT", quantity: 50 }], 5)).toBe(5);
  });
  it("falls back to dispensedQty when no ledger rows exist", () => {
    expect(netDispensedQty([], 12)).toBe(12);
    expect(netDispensedQty(undefined, 0)).toBe(0);
  });
  it("uses dispensedQty when only RETURN rows exist (dispensed before the ledger)", () => {
    expect(netDispensedQty([{ type: "RETURN", quantity: 3 }], 7)).toBe(7);
  });
  it("never goes negative", () => {
    expect(netDispensedQty([{ type: "DISPENSE", quantity: -2 }, { type: "RETURN", quantity: 5 }], 0)).toBe(0);
    expect(netDispensedQty([{ type: "RETURN", quantity: 2 }], -1)).toBe(0);
  });
  it("offers only the unbilled difference and reports over-billing as a credit", () => {
    expect(pharmacyBillableQty(10, 0)).toEqual({ qty: 10, credit: 0 });
    expect(pharmacyBillableQty(12, 10)).toEqual({ qty: 2, credit: 0 });
    expect(pharmacyBillableQty(10, 10)).toEqual({ qty: 0, credit: 0 });
    expect(pharmacyBillableQty(7, 10)).toEqual({ qty: 0, credit: 3 });
  });
});

describe("invoice totals", () => {
  it("applies line discount before tax with exact decimals", () => {
    const line = buildLine({ quantity: 3, unitPrice: "333.33", discount: "99.99", taxRate: "5" });
    // gross 999.99 − 99.99 = 900.00; tax 45.00
    expect(line).toEqual({ quantity: 3, unitPrice: "333.33", discount: "99.99", taxRate: "5.00", lineTotal: "945.00" });
  });
  it("totals several lines and nets payments and refunds", () => {
    const items = [
      { quantity: 1, unitPrice: "2500.00", discount: "250.00", taxRate: "0" },
      { quantity: 10, unitPrice: "4.00", discount: "0", taxRate: "17" },
      { quantity: 2, unitPrice: "0.10", discount: "0", taxRate: "0" },
    ];
    const t = invoiceTotals(items, { amountPaid: "1000", amountRefunded: "100" });
    expect(t).toEqual({ subtotal: "2540.20", discountTotal: "250.00", taxTotal: "6.80", total: "2297.00", balance: "1397.00" });
  });
  it("rejects a discount larger than the line amount", () => {
    expect(() => buildLine({ quantity: 1, unitPrice: "100", discount: "100.01" })).toThrow();
  });
  it("rounds tax half-up to 2 decimals", () => {
    expect(buildLine({ quantity: 1, unitPrice: "0.05", taxRate: "10" }).lineTotal).toBe("0.06");
  });
});

describe("invoice status derivation", () => {
  it("derives status from money columns", () => {
    expect(deriveInvoiceStatus({ total: "100", amountPaid: "0", amountRefunded: "0" })).toBe("ISSUED");
    expect(deriveInvoiceStatus({ total: "100", amountPaid: "40", amountRefunded: "0" })).toBe("PARTIALLY_PAID");
    expect(deriveInvoiceStatus({ total: "100", amountPaid: "100", amountRefunded: "0" })).toBe("PAID");
    expect(deriveInvoiceStatus({ total: "100", amountPaid: "100", amountRefunded: "30" })).toBe("PARTIALLY_PAID");
    expect(deriveInvoiceStatus({ total: "100", amountPaid: "100", amountRefunded: "100" })).toBe("REFUNDED");
    expect(deriveInvoiceStatus({ total: "0", amountPaid: "0", amountRefunded: "0" })).toBe("PAID");
  });
});

describe("payment guard", () => {
  const methods = ["CASH", "CARD", "BANK_TRANSFER"];
  const inv = { status: "PARTIALLY_PAID", balance: "500.00" };
  it("accepts a valid payment up to the balance", () => {
    expect(paymentGuard(inv, { amount: "500.00", method: "CASH" }, methods)).toBeNull();
    expect(paymentGuard(inv, { amount: "0.01", method: "CARD" }, methods)).toBeNull();
  });
  it("rejects over-payment, zero and disabled methods", () => {
    expect(paymentGuard(inv, { amount: "500.01", method: "CASH" }, methods)).toMatch(/exceeds/);
    expect(paymentGuard(inv, { amount: "0", method: "CASH" }, methods)).toMatch(/greater than zero/);
    expect(paymentGuard(inv, { amount: "10", method: "CHEQUE" }, methods)).toMatch(/not enabled/);
  });
  it("reserves INSURANCE for claim settlement but allows it on any open or refunded invoice", () => {
    expect(paymentGuard(inv, { amount: "10", method: "INSURANCE" }, methods)).toBeNull();
    expect(paymentGuard({ status: "REFUNDED", balance: "100" }, { amount: "100", method: "INSURANCE" }, methods)).toBeNull();
    expect(paymentGuard({ status: "REFUNDED", balance: "100" }, { amount: "100", method: "CASH" }, methods)).toMatch(/cannot be recorded/);
  });
  it("blocks payments on draft, paid and void invoices", () => {
    expect(paymentGuard({ status: "DRAFT", balance: "100" }, { amount: "1", method: "CASH" }, methods)).toMatch(/Issue/);
    expect(paymentGuard({ status: "PAID", balance: "0" }, { amount: "1", method: "CASH" }, methods)).toMatch(/paid invoice/);
    expect(paymentGuard({ status: "VOID", balance: "100" }, { amount: "1", method: "CASH" }, methods)).toMatch(/void/);
  });
  it("validates the payment payload", () => {
    expect(paymentSchema.safeParse({ amount: "10.5", method: "CASH", idempotencyKey: "8f14e45f-ceea-4e7a-9b1c-1f0e7f3c2a11" }).success).toBe(true);
    expect(paymentSchema.safeParse({ amount: "10.555", method: "CASH", idempotencyKey: "8f14e45f-ceea-4e7a-9b1c-1f0e7f3c2a11" }).success).toBe(false);
    expect(paymentSchema.safeParse({ amount: "10", method: "CASH" }).success).toBe(false);
    expect(paymentSchema.safeParse({ amount: "-5", method: "CASH", idempotencyKey: "8f14e45f-ceea-4e7a-9b1c-1f0e7f3c2a11" }).success).toBe(false);
  });
});

describe("refund and void guards", () => {
  const methods = ["CASH", "CARD"];
  it("limits refunds to the net amount paid", () => {
    const inv = { status: "PAID", amountPaid: "1000", amountRefunded: "200" };
    expect(refundableAmount(inv).toFixed(2)).toBe("800.00");
    expect(refundGuard(inv, { amount: "800", method: "CASH" }, methods)).toBeNull();
    expect(refundGuard(inv, { amount: "800.01", method: "CASH" }, methods)).toMatch(/exceeds/);
    expect(refundGuard(inv, { amount: "10", method: "WIRE" }, methods)).toMatch(/not enabled/);
  });
  it("refuses refunds on unpaid or already refunded invoices", () => {
    expect(refundGuard({ status: "ISSUED", amountPaid: "0", amountRefunded: "0" }, { amount: "1", method: "CASH" }, methods)).toMatch(/Only paid/);
    expect(refundGuard({ status: "REFUNDED", amountPaid: "50", amountRefunded: "50" }, { amount: "1", method: "CASH" }, methods)).toMatch(/Only paid/);
  });
  it("voids only drafts or issued invoices with no net payment and no open claims", () => {
    expect(voidGuard({ status: "DRAFT", amountPaid: "0", amountRefunded: "0" })).toBeNull();
    expect(voidGuard({ status: "ISSUED", amountPaid: "0", amountRefunded: "0" })).toBeNull();
    expect(voidGuard({ status: "ISSUED", amountPaid: "0", amountRefunded: "0" }, { openClaims: 1 })).toMatch(/claims/);
    expect(voidGuard({ status: "PARTIALLY_PAID", amountPaid: "10", amountRefunded: "0" })).toMatch(/Only draft/);
    expect(voidGuard({ status: "ISSUED", amountPaid: "10", amountRefunded: "0" })).toMatch(/Refund/);
    expect(voidGuard({ status: "VOID", amountPaid: "0", amountRefunded: "0" })).toMatch(/Only draft/);
  });
  it("requires items and a discount reason before issuing", () => {
    expect(issueGuard({ status: "DRAFT", discountTotal: "0" }, 0)).toMatch(/at least one/);
    expect(issueGuard({ status: "DRAFT", discountTotal: "50", discountReason: null }, 2)).toMatch(/reason/);
    expect(issueGuard({ status: "DRAFT", discountTotal: "50", discountReason: "Staff" }, 2)).toBeNull();
    expect(issueGuard({ status: "ISSUED", discountTotal: "0" }, 2)).toMatch(/Only draft/);
  });
  it("requires a reason for a non-zero line discount", () => {
    expect(lineUpdateSchema.safeParse({ discount: "100" }).success).toBe(false);
    expect(lineUpdateSchema.safeParse({ discount: "100", reason: "Senior citizen concession" }).success).toBe(true);
    expect(lineUpdateSchema.safeParse({ discount: "0" }).success).toBe(true);
    expect(lineUpdateSchema.safeParse({ taxRate: "101" }).success).toBe(false);
  });
  it("requires something to bill on a new invoice", () => {
    expect(createInvoiceSchema.safeParse({ patientId: "p1", sources: [], items: [] }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ patientId: "p1", sources: [{ sourceType: "Encounter", sourceId: "e1" }] }).success).toBe(true);
  });
});

describe("ageing buckets", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const ago = (d, extraMs = 0) => new Date(now.getTime() - d * DAY - extraMs);
  it("buckets by whole days since issue", () => {
    expect(ageingBucket(ago(0), now)).toBe("0-30");
    expect(ageingBucket(ago(30, H), now)).toBe("0-30");
    expect(ageingBucket(ago(31), now)).toBe("31-60");
    expect(ageingBucket(ago(60, H), now)).toBe("31-60");
    expect(ageingBucket(ago(61), now)).toBe("61-90");
    expect(ageingBucket(ago(91), now)).toBe("90+");
    expect(daysSince(ago(45, H), now)).toBe(45);
  });
  it("database ranges agree with the bucket function", () => {
    const inRange = (d, r) => (!r.gt || d > r.gt) && (!r.lte || d <= r.lte);
    for (const days of [0, 1, 29, 30, 31, 45, 60, 61, 89, 90, 91, 200]) {
      for (const extra of [0, H, DAY - 1]) {
        const d = ago(days, extra);
        const b = ageingBucket(d, now);
        expect(inRange(d, ageingRange(b, now))).toBe(true);
        for (const other of ["0-30", "31-60", "61-90", "90+"].filter((x) => x !== b)) expect(inRange(d, ageingRange(other, now))).toBe(false);
      }
    }
  });
});

describe("insurance claims", () => {
  it("allows only the documented status transitions", () => {
    expect(canTransitionClaim("SUBMITTED", "APPROVED")).toBe(true);
    expect(canTransitionClaim("SUBMITTED", "PARTIALLY_APPROVED")).toBe(true);
    expect(canTransitionClaim("SUBMITTED", "REJECTED")).toBe(true);
    expect(canTransitionClaim("APPROVED", "PAID")).toBe(true);
    expect(canTransitionClaim("PARTIALLY_APPROVED", "PAID")).toBe(true);
    expect(canTransitionClaim("SUBMITTED", "PAID")).toBe(false);
    expect(canTransitionClaim("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionClaim("PAID", "REJECTED")).toBe(false);
    expect(canTransitionClaim("APPROVED", "REJECTED")).toBe(false);
  });
  it("validates decisions", () => {
    const claim = { status: "SUBMITTED", claimAmount: "5000.00", approvedAmount: null };
    expect(resolveClaimDecision(claim, { status: "APPROVED" })).toEqual({ approvedAmount: "5000.00" });
    expect(resolveClaimDecision(claim, { status: "APPROVED", approvedAmount: "4000" }).error).toMatch(/partial/i);
    expect(resolveClaimDecision(claim, { status: "PARTIALLY_APPROVED", approvedAmount: "3500.5" })).toEqual({ approvedAmount: "3500.50" });
    expect(resolveClaimDecision(claim, { status: "PARTIALLY_APPROVED", approvedAmount: "5000" }).error).toBeTruthy();
    expect(resolveClaimDecision(claim, { status: "PARTIALLY_APPROVED" }).error).toBeTruthy();
    expect(resolveClaimDecision(claim, { status: "REJECTED" }).error).toMatch(/reason/);
    expect(resolveClaimDecision(claim, { status: "REJECTED", rejectionReason: "Not covered" })).toEqual({ approvedAmount: null });
    expect(resolveClaimDecision(claim, { status: "PAID" }).error).toBeTruthy();
    expect(resolveClaimDecision({ ...claim, status: "APPROVED", approvedAmount: "5000" }, { status: "PAID" })).toEqual({ approvedAmount: "5000.00" });
  });
  it("caps the settlement at the invoice balance", () => {
    expect(insuranceSettlementAmount("5000", "8000")).toBe("5000.00");
    expect(insuranceSettlementAmount("5000", "1200.50")).toBe("1200.50");
    expect(insuranceSettlementAmount("5000", "0")).toBe("0.00");
  });
  it("checks policy coverage dates inclusively", () => {
    const p = { coverageStart: new Date("2026-01-01"), coverageEnd: new Date("2026-12-31") };
    expect(policyCoversDate(p, "2026-01-01")).toBe(true);
    expect(policyCoversDate(p, "2026-12-31")).toBe(true);
    expect(policyCoversDate(p, "2027-01-01")).toBe(false);
    expect(policyCoversDate(p, "2025-12-31")).toBe(false);
  });
  it("limits the total of open claims to the invoice total", () => {
    expect(claimableRemaining("10000", [])).toBe("10000.00");
    expect(claimableRemaining("10000", ["4000", "2500.25"])).toBe("3499.75");
    expect(claimableRemaining("10000", ["12000"])).toBe("0.00");
  });
  it("requires coverage end on or after start", () => {
    const base = { patientId: "p", providerId: "v", policyNumber: "X-1", coverageStart: "2026-05-01" };
    expect(policySchema.safeParse({ ...base, coverageEnd: "2026-04-30" }).success).toBe(false);
    expect(policySchema.safeParse({ ...base, coverageEnd: "2026-05-01" }).success).toBe(true);
  });
});
