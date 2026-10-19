import { describe, it, expect } from "vitest";
import { calcLine, calcInvoiceTotals, toMoneyString } from "@/lib/utils/money";

describe("money", () => {
  it("avoids floating point errors", () => {
    expect(calcInvoiceTotals([{ quantity: 3, unitPrice: "0.10" }]).total).toBe("0.30");
    expect(toMoneyString("0.1") ).toBe("0.10");
  });
  it("applies discount then tax", () => {
    expect(calcLine({ quantity: 2, unitPrice: "1000.00", discount: "200", taxRate: "5" })).toEqual({ gross: "2000.00", discount: "200.00", tax: "90.00", lineTotal: "1890.00" });
  });
  it("rejects discount above line amount", () => {
    expect(() => calcLine({ quantity: 1, unitPrice: "100", discount: "150" })).toThrow();
  });
  it("computes balance net of payments and refunds", () => {
    const t = calcInvoiceTotals([{ quantity: 1, unitPrice: "2500" }, { quantity: 2, unitPrice: "450" }], { amountPaid: "3000", amountRefunded: "100" });
    expect(t.total).toBe("3400.00");
    expect(t.balance).toBe("500.00");
  });
});
