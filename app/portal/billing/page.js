import { Receipt, Info } from "lucide-react";
import { requirePortalSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { portalBilling } from "@/lib/services/dashboard";
import { formatMoney, D } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";

export const metadata = { title: "Invoices" };

export default async function PortalBillingPage() {
  const session = await requirePortalSession();
  const h = await getHospital();
  const tz = h.timezone;
  const money = (v) => formatMoney(v, h.currency, h.locale);
  const { invoices, payments, outstanding } = await portalBilling(session.patientId);
  return (
    <>
      <PageHeader title="My invoices & payments" description={`Amount due: ${money(outstanding)}`} />
      <div role="note" className="mb-5 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-[13px] text-info flex gap-2">
        <Info size={16} className="shrink-0 mt-0.5" aria-hidden />
        <p>Payments are made at the hospital billing counter (cash, card or bank transfer). Online payment is not available in this portal. Questions about a charge? Contact the billing office with the invoice number.</p>
      </div>
      {invoices.length === 0 ? <div className="card mb-5"><EmptyState icon={Receipt} title="No invoices" /></div> : (
        <div className="space-y-4 mb-6">
          {invoices.map((inv) => (
            <details key={inv.id} className="card group" open={["ISSUED", "PARTIALLY_PAID"].includes(inv.status)}>
              <summary className="card-header cursor-pointer list-none flex-wrap">
                <div>
                  <p className="card-title">{inv.invoiceNo}</p>
                  <p className="text-xs text-muted">Issued {formatDate(inv.issuedAt || inv.createdAt, tz)} · {inv.items.length} item{inv.items.length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-right"><span className="block text-xs text-muted">Balance</span><span className="font-bold tabular">{money(inv.balance)}</span></span>
                  <StatusBadge status={inv.status} />
                </div>
              </summary>
              <div className="table-wrap">
                <table className="table table-responsive">
                  <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Line total</th></tr></thead>
                  <tbody>
                    {inv.items.map((it) => (
                      <tr key={it.id}>
                        <td data-label="Item">{it.description}<span className="block text-xs text-muted">{it.category.toLowerCase()}</span></td>
                        <td data-label="Qty" className="num">{it.quantity}</td>
                        <td data-label="Unit price" className="num">{money(it.unitPrice)}</td>
                        <td data-label="Discount" className="num">{D(it.discount).isZero() ? "—" : money(it.discount)}</td>
                        <td data-label="Line total" className="num font-medium">{money(it.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="px-4 py-3 border-t border-border grid grid-cols-2 sm:grid-cols-5 gap-3 text-[13px]">
                <div><dt className="text-xs text-muted">Subtotal</dt><dd className="tabular">{money(inv.subtotal)}</dd></div>
                <div><dt className="text-xs text-muted">Discounts</dt><dd className="tabular">{money(inv.discountTotal)}</dd></div>
                <div><dt className="text-xs text-muted">Tax</dt><dd className="tabular">{money(inv.taxTotal)}</dd></div>
                <div><dt className="text-xs text-muted">Paid{D(inv.amountRefunded).gt(0) ? " (net of refunds)" : ""}</dt><dd className="tabular">{money(D(inv.amountPaid).minus(D(inv.amountRefunded)))}</dd></div>
                <div><dt className="text-xs text-muted">Total</dt><dd className="tabular font-semibold">{money(inv.total)}</dd></div>
              </dl>
            </details>
          ))}
        </div>
      )}
      <section className="card" aria-labelledby="pay-h">
        <header className="card-header"><h2 id="pay-h" className="card-title">Payments</h2></header>
        <DataTable rows={payments} caption="Payments" empty={<EmptyState title="No payments recorded" />} columns={[
          { key: "receiptNo", label: "Receipt", render: (p) => <code className="text-[12px]">{p.receiptNo}</code> },
          { key: "invoice", label: "Invoice", render: (p) => p.invoice.invoiceNo },
          { key: "receivedAt", label: "Date", render: (p) => formatDateTime(p.receivedAt, tz) },
          { key: "method", label: "Method", render: (p) => p.method.replace("_", " ").toLowerCase() },
          { key: "amount", label: "Amount", align: "right", render: (p) => <span className="font-semibold">{money(p.amount)}</span> },
        ]} />
      </section>
    </>
  );
}
