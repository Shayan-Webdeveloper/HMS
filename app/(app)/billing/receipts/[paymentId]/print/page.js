import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { getReceipt } from "@/lib/services/billing";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { formatMoney } from "@/lib/utils/money";
import { formatDateTime, formatDate } from "@/lib/utils/time";
import { methodLabel } from "@/lib/validation/billing";
import { PrintButton } from "@/components/billing/PrintButton";
import { DocumentHeader } from "@/components/billing/DocumentHeader";

export const metadata = { title: "Print receipt" };

export default async function PrintReceiptPage({ params }) {
  const session = await requirePageSession("billing:read");
  const { paymentId } = await params;
  const p = await getReceipt(paymentId);
  if (!p) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const money = (v) => formatMoney(v, h.currency, h.locale);
  await audit({ userId: session.user.id, action: "receipt.print", entityType: "Invoice", entityId: p.invoice.id, metadata: { paymentId: p.id } });
  const inv = p.invoice;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 mb-4">
        <Link href={`/billing/${inv.id}`} className="btn btn-ghost"><ArrowLeft size={15} aria-hidden /> Back to invoice</Link>
        <PrintButton label="Print receipt" />
      </div>
      <article className="card p-6 sm:p-10 print-doc">
        <DocumentHeader hospital={h} title="Payment receipt" lines={[["Receipt no.", p.receiptNo], ["Date", formatDateTime(p.receivedAt, tz)]]} />
        <section className="py-6 text-center border-b border-border">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Amount received</p>
          <p className="text-[32px] font-bold tabular tracking-tight">{money(p.amount)}</p>
          <p className="text-[13px] text-muted">via {methodLabel(p.method)}{p.reference ? ` · ref. ${p.reference}` : ""}</p>
        </section>
        <dl className="py-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-[13.5px]">
          <div><dt className="text-xs text-muted uppercase font-semibold tracking-wide">Received from</dt><dd className="font-medium">{inv.patient.firstName} {inv.patient.lastName}</dd><dd className="text-muted font-mono">{inv.patient.mrn}</dd></div>
          <div><dt className="text-xs text-muted uppercase font-semibold tracking-wide">Against invoice</dt><dd className="font-mono font-medium">{inv.invoiceNo}</dd><dd className="text-muted">Issued {formatDate(inv.issuedAt, tz)}</dd></div>
          <div><dt className="text-xs text-muted uppercase font-semibold tracking-wide">Invoice total</dt><dd className="tabular">{money(inv.total)}</dd></div>
          <div><dt className="text-xs text-muted uppercase font-semibold tracking-wide">Current balance</dt><dd className="tabular font-semibold">{inv.status === "VOID" ? money(0) : money(inv.balance)}</dd></div>
          <div><dt className="text-xs text-muted uppercase font-semibold tracking-wide">Received by</dt><dd>{p.receivedBy}</dd></div>
        </dl>
        <footer className="mt-4 pt-3 border-t border-border text-[11.5px] text-subtle flex flex-wrap justify-between gap-2">
          <span>Generated {formatDateTime(new Date(), tz)} ({tz})</span>
          <span>{h.name} · computer-generated receipt</span>
        </footer>
      </article>
    </div>
  );
}
