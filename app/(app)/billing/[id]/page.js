import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer, AlertTriangle, Ban } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { getInvoiceDetail, getBillingSettings, getServiceCatalog } from "@/lib/services/billing";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { formatMoney, D } from "@/lib/utils/money";
import { formatDateTime, formatDate } from "@/lib/utils/time";
import { categoryLabel, methodLabel } from "@/lib/validation/billing";
import { serialize } from "@/lib/utils/serialize";
import { Card } from "@/components/ui/Card";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { InvoiceActions } from "@/components/billing/InvoiceActions";
import { DraftLineActions } from "@/components/billing/DraftLineActions";
import { AddChargesButton } from "@/components/billing/AddChargesButton";
import { ClaimStatusBadge } from "@/components/insurance/ClaimStatusBadge";

export const metadata = { title: "Invoice" };

const SOURCE_LABEL = { Encounter: "Consultation", LabOrderItem: "Lab order", ImagingStudy: "Imaging study", PrescriptionItem: "Dispensed medicine", BedAssignment: "Bed stay", Procedure: "Procedure" };
const sourceLabel = (t) => (t ? (t.startsWith("BedAssignment:interim") ? "Bed stay (interim)" : SOURCE_LABEL[t] || t) : "Manual item");

export default async function InvoicePage({ params }) {
  const session = await requirePageSession("billing:read");
  const { id } = await params;
  const inv = await getInvoiceDetail(id);
  if (!inv) notFound();
  const [h, settings] = await Promise.all([getHospital(), getBillingSettings()]);
  const tz = h.timezone;
  const money = (v) => formatMoney(v, h.currency, h.locale);
  await audit({ userId: session.user.id, action: "invoice.view", entityType: "Invoice", entityId: inv.id });

  const draft = inv.status === "DRAFT";
  const canCreate = can(session, "billing:create");
  const canDiscount = can(session, "billing:discount");
  const catalog = draft && canCreate ? await getServiceCatalog() : [];
  const netPaid = D(inv.amountPaid).minus(inv.amountRefunded);
  const open = ["ISSUED", "PARTIALLY_PAID"].includes(inv.status);

  return (
    <>
      <div className="mb-5">
        <Link href="/billing" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-2"><ArrowLeft size={14} aria-hidden /> Billing</Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight font-mono">{inv.invoiceNo}</h1>
              <StatusBadge status={inv.status} />
            </div>
            <p className="text-[13.5px] text-muted mt-1">
              <Link href={`/patients/${inv.patient.id}`} className="font-medium text-ink hover:text-primary">{inv.patient.firstName} {inv.patient.lastName}</Link>
              {" "}· <span className="font-mono">{inv.patient.mrn}</span> · created {formatDateTime(inv.createdAt, tz)}{inv.createdBy ? ` by ${inv.createdBy}` : ""}
            </p>
          </div>
          <InvoiceActions
            invoice={serialize({ id: inv.id, invoiceNo: inv.invoiceNo, status: inv.status, total: inv.total, balance: inv.balance, amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded, itemCount: inv.items.length })}
            perms={{ create: canCreate, payment: can(session, "billing:payment"), refund: can(session, "billing:refund"), void: can(session, "billing:void"), claim: can(session, "insurance:manage") }}
            methods={settings.paymentMethods} currency={h.currency} locale={h.locale} />
        </div>
      </div>

      {inv.status === "VOID" && (
        <div role="note" className="mb-4 rounded-lg border border-border bg-neutral-soft px-4 py-3 text-[13.5px] flex gap-2"><Ban size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden /><div><span className="font-semibold">Voided.</span> {inv.voidReason}</div></div>
      )}
      {draft && (
        <div role="note" className="mb-4 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-[13.5px] text-info flex gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /><div>Draft — review lines, discounts and tax, then <span className="font-semibold">issue</span> the invoice to collect payment. Totals are recalculated by the server on every change.</div></div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5 min-w-0">
          <Card title="Items" description={`${inv.items.length} line${inv.items.length === 1 ? "" : "s"}${draft ? " · editable while draft" : " · locked"}`} noPadding
            actions={draft && canCreate && <AddChargesButton invoiceId={inv.id} patientId={inv.patient.id} catalog={catalog} taxRate={settings.taxRatePercent} currency={h.currency} locale={h.locale} tz={tz} />}>
            {inv.items.length === 0 ? <EmptyState title="No items" description={draft ? "Add unbilled charges or services to this draft." : "This invoice has no lines."} /> : (
              <div className="table-wrap">
                <table className="table table-responsive">
                  <caption className="sr-only">Invoice items</caption>
                  <thead><tr><th scope="col">Description</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Unit price</th><th scope="col" className="num">Discount</th><th scope="col" className="num">Tax</th><th scope="col" className="num">Amount</th>{draft && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
                  <tbody>
                    {inv.items.map((it) => (
                      <tr key={it.id}>
                        <td data-label="Item">
                          <div className="text-left">
                            <div className="font-medium">{it.description}</div>
                            <div className="text-xs text-muted mt-0.5 flex flex-wrap gap-1.5 items-center"><Badge tone="neutral" plain>{categoryLabel(it.category)}</Badge>{sourceLabel(it.sourceType)}</div>
                          </div>
                        </td>
                        <td data-label="Qty" className="num">{it.quantity}</td>
                        <td data-label="Unit price" className="num">{money(it.unitPrice)}</td>
                        <td data-label="Discount" className="num">{D(it.discount).gt(0) ? <span className="text-success">−{money(it.discount)}</span> : "—"}</td>
                        <td data-label="Tax" className="num">{D(it.taxRate).toFixed(2)}%</td>
                        <td data-label="Amount" className="num font-semibold">{money(it.lineTotal)}</td>
                        {draft && (
                          <td data-label="">
                            <DraftLineActions invoiceId={inv.id} item={serialize({ id: it.id, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount, taxRate: it.taxRate })}
                              canEdit={canCreate} canDiscount={canDiscount} discountReason={inv.discountReason} maxDiscountPct={settings.maxDiscountPercentWithoutApproval} currency={h.currency} locale={h.locale} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <dl className="border-t border-border px-5 py-4 space-y-1.5 text-[13.5px] sm:ml-auto sm:max-w-sm">
              <Row label="Subtotal" value={money(inv.subtotal)} />
              <Row label="Discount" value={D(inv.discountTotal).gt(0) ? `−${money(inv.discountTotal)}` : money(0)} />
              <Row label="Tax" value={money(inv.taxTotal)} />
              <Row label="Total" value={money(inv.total)} strong />
              {D(inv.discountTotal).gt(0) && inv.discountReason && <p className="text-xs text-muted pt-1">Discount reason: {inv.discountReason}</p>}
            </dl>
          </Card>

          <Card title="Payments" noPadding description={inv.payments.length ? `${inv.payments.length} recorded` : undefined}>
            {inv.payments.length === 0 ? <EmptyState title="No payments yet" description={open ? "Use “Record payment” to take a cash, card-terminal or bank-transfer payment." : draft ? "Issue the invoice to collect payments." : undefined} /> : (
              <div className="table-wrap">
                <table className="table table-responsive">
                  <caption className="sr-only">Payments</caption>
                  <thead><tr><th scope="col">Receipt</th><th scope="col">Received</th><th scope="col">Method</th><th scope="col">Reference</th><th scope="col">By</th><th scope="col" className="num">Amount</th><th scope="col"><span className="sr-only">Print</span></th></tr></thead>
                  <tbody>
                    {inv.payments.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Receipt" className="font-mono text-[12.5px] font-semibold">{p.receiptNo}</td>
                        <td data-label="Received">{formatDateTime(p.receivedAt, tz)}</td>
                        <td data-label="Method"><Badge tone={p.method === "INSURANCE" ? "teal" : "neutral"} plain>{methodLabel(p.method)}</Badge></td>
                        <td data-label="Reference">{p.reference || "—"}</td>
                        <td data-label="By">{p.receivedBy}</td>
                        <td data-label="Amount" className="num font-semibold">{money(p.amount)}</td>
                        <td data-label=""><Link href={`/billing/receipts/${p.id}/print`} className="btn btn-ghost btn-sm" aria-label={`Print receipt ${p.receiptNo}`}><Printer size={14} aria-hidden /> Receipt</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {inv.refunds.length > 0 && (
            <Card title="Refunds" noPadding>
              <div className="table-wrap">
                <table className="table table-responsive">
                  <caption className="sr-only">Refunds</caption>
                  <thead><tr><th scope="col">Date</th><th scope="col">Method</th><th scope="col">Reason</th><th scope="col">Approved by</th><th scope="col" className="num">Amount</th></tr></thead>
                  <tbody>
                    {inv.refunds.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Date">{formatDateTime(r.createdAt, tz)}</td>
                        <td data-label="Method">{methodLabel(r.method)}</td>
                        <td data-label="Reason">{r.reason}</td>
                        <td data-label="Approved by">{r.approvedBy}</td>
                        <td data-label="Amount" className="num font-semibold text-danger">−{money(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {inv.claims.length > 0 && (
            <Card title="Insurance claims" noPadding>
              <div className="table-wrap">
                <table className="table table-responsive">
                  <caption className="sr-only">Insurance claims</caption>
                  <thead><tr><th scope="col">Claim</th><th scope="col">Provider / policy</th><th scope="col" className="num">Claimed</th><th scope="col" className="num">Approved</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {inv.claims.map((c) => (
                      <tr key={c.id}>
                        <td data-label="Claim">{can(session, "insurance:read") ? <Link href={`/insurance/claims/${c.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{c.claimNo}</Link> : <span className="font-mono text-[12.5px]">{c.claimNo}</span>}</td>
                        <td data-label="Provider">{c.policy.provider.name} <span className="text-xs text-muted">· {c.policy.policyNumber}</span></td>
                        <td data-label="Claimed" className="num">{money(c.claimAmount)}</td>
                        <td data-label="Approved" className="num">{c.approvedAmount != null ? money(c.approvedAmount) : "—"}</td>
                        <td data-label="Status"><ClaimStatusBadge status={c.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card title="Balance">
            <p className="text-xs text-muted">{inv.status === "VOID" ? "Void — nothing owed" : inv.status === "REFUNDED" ? "Fully refunded — closed to counter payments" : "Outstanding"}</p>
            <p className={`text-[28px] font-bold tabular tracking-tight ${open && D(inv.balance).gt(0) ? "text-warning" : inv.status === "REFUNDED" ? "text-muted" : ""}`}>{inv.status === "VOID" ? money(0) : money(inv.balance)}</p>
            <dl className="mt-3 space-y-1.5 text-[13.5px]">
              <Row label="Invoice total" value={money(inv.total)} />
              <Row label="Paid" value={money(inv.amountPaid)} />
              {D(inv.amountRefunded).gt(0) && <Row label="Refunded" value={`−${money(inv.amountRefunded)}`} />}
              <Row label="Net paid" value={money(netPaid)} strong />
            </dl>
          </Card>
          <Card title="Details">
            <dl className="space-y-2.5 text-[13.5px]">
              <Detail label="Patient"><Link href={`/patients/${inv.patient.id}`} className="text-primary hover:underline">{inv.patient.firstName} {inv.patient.lastName}</Link> <span className="text-muted font-mono text-xs">{inv.patient.mrn}</span></Detail>
              {inv.patient.phone && <Detail label="Phone">{inv.patient.phone}</Detail>}
              <Detail label="Created">{formatDateTime(inv.createdAt, tz)}</Detail>
              <Detail label="Issued">{inv.issuedAt ? formatDate(inv.issuedAt, tz) : "Not issued"}</Detail>
              {inv.voidReason && <Detail label="Void reason">{inv.voidReason}</Detail>}
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "font-bold text-[14.5px] pt-1.5 border-t border-border" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt><dd className="tabular">{value}</dd>
    </div>
  );
}

function Detail({ label, children }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}
