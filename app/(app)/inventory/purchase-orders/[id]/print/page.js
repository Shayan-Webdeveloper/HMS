import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { getPurchaseOrder } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";
import { formatMoney } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/time";
import { humanize } from "@/lib/validation/inventory";
import { Button } from "@/components/ui/Button";
import { PrintButton } from "@/components/inventory/common";

export const metadata = { title: "Print purchase order" };

export default async function PrintPurchaseOrderPage({ params }) {
  const session = await requirePageSession("inventory:read");
  const { id } = await params;
  const [po, h] = await Promise.all([getPurchaseOrder(id), getHospital()]);
  if (!po) notFound();
  const money = (v) => formatMoney(v, h.currency);
  const profile = h.settings?.["hospital.profile"] || {};
  const draft = po.status === "DRAFT", cancelled = po.status === "CANCELLED";

  return (
    <div className="max-w-3xl mx-auto">
      <div className="no-print flex items-center justify-between gap-2 mb-4">
        <Button icon={ArrowLeft} href={`/inventory/purchase-orders/${po.id}`}>Back</Button>
        <PrintButton label="Print purchase order" />
      </div>
      <article className="card print-doc p-6 sm:p-8 relative">
        {(draft || cancelled) && <p className="absolute top-4 right-4 sm:right-8 text-[11px] font-bold uppercase tracking-widest text-danger border border-danger/40 rounded px-2 py-0.5">{draft ? "Draft — not an order" : "Cancelled"}</p>}
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-border">
          <div>
            <p className="text-[18px] font-bold">{h.name}</p>
            {(h.address || profile.address) && <p className="text-[12.5px] text-muted">{h.address || profile.address}</p>}
            {(h.phone || profile.phone) && <p className="text-[12.5px] text-muted">Tel. {h.phone || profile.phone}</p>}
            {(h.email || profile.email) && <p className="text-[12.5px] text-muted">{h.email || profile.email}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Purchase order</p>
            <p className="font-mono text-[17px] font-bold">{po.poNumber}</p>
            <p className="text-[12.5px] text-muted">Date {formatDate(po.orderedAt ?? po.createdAt, h.timezone)}</p>
            <p className="text-[12.5px] text-muted">Status {humanize(po.status)}</p>
          </div>
        </header>
        <section className="py-4 border-b border-border text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Supplier</p>
          <p className="font-semibold text-[14px]">{po.supplier.name}</p>
          {po.supplier.address && <p className="text-muted">{po.supplier.address}</p>}
          <p className="text-muted">{[po.supplier.phone, po.supplier.email].filter(Boolean).join(" · ")}</p>
        </section>
        <div className="table-wrap mt-2"><table className="table">
          <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit cost</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {po.items.map((l, i) => (
              <tr key={l.id}>
                <td className="tabular">{i + 1}</td>
                <td><span className="font-medium">{l.inventoryItem.name}</span> <span className="text-xs text-muted font-mono">{l.inventoryItem.code}</span></td>
                <td className="num">{l.quantity}</td>
                <td>{l.inventoryItem.unit}</td>
                <td className="num">{money(l.unitCost)}</td>
                <td className="num font-semibold">{money(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5} className="num font-semibold">Total</td><td className="num font-bold text-[14px]">{money(po.total)}</td></tr>
          </tfoot>
        </table></div>
        <footer className="grid sm:grid-cols-2 gap-8 mt-10 text-[12.5px]">
          <div><p className="border-t border-border-strong pt-1 text-subtle">Prepared by{po.createdByName ? ` — ${po.createdByName}` : ""}</p></div>
          <div><p className="border-t border-border-strong pt-1 text-subtle">Authorised signature</p></div>
        </footer>
        <p className="mt-6 text-[11px] text-subtle">Printed {formatDateTime(new Date(), h.timezone)} by {session.user.name}. Please quote the PO number on all delivery notes and invoices.</p>
      </article>
    </div>
  );
}
