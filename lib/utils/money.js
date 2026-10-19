import Decimal from "decimal.js";

// All money arithmetic goes through Decimal — never JS floats.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export const D = (v) => new Decimal(v == null || v === "" ? 0 : v.toString());
export const round2 = (v) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const toMoneyString = (v) => round2(v).toFixed(2);

/**
 * Calculates a line: quantity × unitPrice − discount, then tax on the discounted amount.
 * Returns strings (2dp) so they can be stored directly in Decimal columns.
 */
export function calcLine({ quantity, unitPrice, discount = 0, taxRate = 0 }) {
  const gross = D(unitPrice).mul(quantity);
  const disc = D(discount);
  if (disc.isNegative()) throw new Error("Discount cannot be negative");
  if (disc.gt(gross)) throw new Error("Discount cannot exceed the line amount");
  const net = gross.minus(disc);
  const tax = round2(net.mul(D(taxRate)).div(100));
  return {
    gross: toMoneyString(gross),
    discount: toMoneyString(disc),
    tax: toMoneyString(tax),
    lineTotal: toMoneyString(net.plus(tax)),
  };
}

export function calcInvoiceTotals(items, { amountPaid = 0, amountRefunded = 0 } = {}) {
  let subtotal = D(0), discountTotal = D(0), taxTotal = D(0), total = D(0);
  for (const it of items) {
    const l = calcLine(it);
    subtotal = subtotal.plus(l.gross);
    discountTotal = discountTotal.plus(l.discount);
    taxTotal = taxTotal.plus(l.tax);
    total = total.plus(l.lineTotal);
  }
  const netPaid = D(amountPaid).minus(D(amountRefunded));
  const balance = total.minus(netPaid);
  return {
    subtotal: toMoneyString(subtotal),
    discountTotal: toMoneyString(discountTotal),
    taxTotal: toMoneyString(taxTotal),
    total: toMoneyString(total),
    balance: toMoneyString(balance),
  };
}

export function formatMoney(value, currency = "PKR", locale = "en-PK") {
  const n = Number(D(value).toFixed(2));
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${D(value).toFixed(2)}`;
  }
}
