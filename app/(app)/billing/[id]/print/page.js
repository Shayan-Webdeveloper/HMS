import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { getInvoiceDetail } from "@/lib/services/billing";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { formatMoney, D } from "@/lib/utils/money";
import { formatDateTime, formatDate } from "@/lib/utils/time";
import { categoryLabel, methodLabel } from "@/lib/validation/billing";
import { PrintButton } from "@/components/billing/PrintButton";
import { DocumentHeader } from "@/components/billing/DocumentHeader";

export const metadata = { title: "Print invoice" };

export default async function PrintInvoicePage({ params }) {
  const session = await requirePageSession("billing:read");
  const { id } = await params;
  const inv = await getInvoiceDetail(id);
  if (!inv) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const money = (v) => formatMoney(v, h.currency, h.locale);
  await audit({ userId: session.user.id, action: "invoice.print", entityType: "Invoice", entityId: inv.id });
  const title = inv.status === "DRAFT" ? "Draft invoice" : inv.status === "VOID" ? "Invoice (void)" : "Invoice";

  return (
    <div className="max-w-4xl mx-auto">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 mb-4">
        <Link href={`/billing/${inv.id}`} className="btn btn-ghost"><ArrowLeft size={15} aria-hidden /> Back to invoice</Link>
        <div className="flex gap-2">
          <a className="btn btn-secondary" href={`/api/invoices/${inv.id}/pdf`} download><FileDown size={15} aria-hidden /> Download PDF</a>
          <PrintButton />
        </div>
      </div>
      <article className="card p-6 sm:p-10 print-doc">
        <DocumentHeader hospital={h} title={title} lines={[["Invoice no.", inv.invoiceNo], ["Date", formatDate(inv.issuedAt ?? inv.createdAt, tz)], ["Status", inv.status.replace(/_/g, " ").toLowerCase()]]} />
        <section className="py-5 grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Bill to</p>
            <p className="font-semibold text-[15px]">{inv.patient.firstName} {inv.patient.lastName}</p>
            <p className="text-[13px] font-mono">{inv.patient.mrn}</p>
            {inv.patient.phone && <p className="text-[13px] text-muted">{inv.patient.phone}</p>}
            {(inv.patient.address || inv.patient.city) && <p className="text-[13px] text-muted">{[inv.patient.address, inv.patient.city].filter(Boolean).join(", ")}</p>}
          </div>
          {inv.status === "VOID" && <div className="sm:text-right"><p className="inline-block rounded border-2 border-danger text-danger font-bold px-3 py-1 uppercase tracking-widest">Void</p><p className="text-[12.5px] text-muted mt-1">{inv.voidReason}</p></div>}
        </section>
        <table className="table">
          <caption className="sr-only">Invoice items</caption>
          <thead><tr><th scope="col">Description</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Unit price</th><th scope="col" className="num">Discount</th><th scope="col" className="num">Tax %</th><th scope="col" className="num">Amount</th></tr></thead>
          <tbody>
            {inv.items.map((it) => (
              <tr key={it.id}>
                <td><div className="font-medium">{it.description}</div><div className="text-xs text-muted">{categoryLabel(it.category)}</div></td>
                <td className="num">{it.quantity}</td>
                <td className="num">{money(it.unitPrice)}</td>
                <td className="num">{D(it.discount).gt(0) ? `−${money(it.discount)}` : "—"}</td>
                <td className="num">{D(it.taxRate).toFixed(2)}</td>
                <td className="num font-semibold">{money(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-4 ml-auto max-w-xs space-y-1 text-[13.5px]">
          {[["Subtotal", money(inv.subtotal)], ["Discount", `−${money(inv.discountTotal)}`], ["Tax", money(inv.taxTotal)]].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="tabular">{v}</dd></div>)}
          <div className="flex justify-between font-bold text-[15px] border-t border-border pt-1.5"><dt>Total</dt><dd className="tabular">{money(inv.total)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd className="tabular">{money(inv.amountPaid)}</dd></div>
          {D(inv.amountRefunded).gt(0) && <div className="flex justify-between"><dt className="text-muted">Refunded</dt><dd className="tabular">−{money(inv.amountRefunded)}</dd></div>}
          <div className="flex justify-between font-bold text-[15px] border-t border-border pt-1.5"><dt>Balance due</dt><dd className="tabular">{inv.status === "VOID" ? money(0) : money(inv.balance)}</dd></div>
        </dl>
        {D(inv.discountTotal).gt(0) && inv.discountReason && <p className="text-[12.5px] text-muted mt-2">Discount reason: {inv.discountReason}</p>}
        {inv.payments.length > 0 && (
          <section className="mt-6">
            <h2 className="font-semibold text-[14px] mb-2">Payments received</h2>
            <table className="table">
              <caption className="sr-only">Payments</caption>
              <thead><tr><th scope="col">Receipt</th><th scope="col">Date</th><th scope="col">Method</th><th scope="col">Reference</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>
                {inv.payments.map((p) => <tr key={p.id}><td className="font-mono text-[12.5px]">{p.receiptNo}</td><td>{formatDateTime(p.receivedAt, tz)}</td><td>{methodLabel(p.method)}</td><td>{p.reference || "—"}</td><td className="num">{money(p.amount)}</td></tr>)}
              </tbody>
            </table>
          </section>
        )}
        <footer className="mt-8 pt-3 border-t border-border text-[11.5px] text-subtle flex flex-wrap justify-between gap-2">
          <span>Generated {formatDateTime(new Date(), tz)} ({tz})</span>
          <span>{h.name} · computer-generated document</span>
        </footer>
      </article>
    </div>
  );
}
