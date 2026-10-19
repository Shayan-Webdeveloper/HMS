import Link from "next/link";
import { FilePlus2, Wallet, Banknote, Undo2, FileClock, Info, Printer } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQuery } from "@/lib/validation/common";
import { INVOICE_STATUSES, AGEING_BUCKETS, invoiceListQuery, paymentListQuery, methodLabel } from "@/lib/validation/billing";
import { listInvoices, getBillingSummary, getAgeing, listOutstanding, listPayments, getBillingSettings } from "@/lib/services/billing";
import { getHospital } from "@/lib/services/settings";
import { formatMoney, D } from "@/lib/utils/money";
import { formatDate, formatDateTime, todayInTz } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { LinkTabs } from "@/components/ui/Tabs";
import { DataTable, Pagination, buildHref } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";

export const metadata = { title: "Billing & Payments" };

const TABS = [
  { key: "invoices", label: "Invoices" },
  { key: "outstanding", label: "Outstanding" },
  { key: "payments", label: "Payments" },
];

const statusLabel = (s) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default async function BillingPage({ searchParams }) {
  const session = await requirePageSession("billing:read");
  const sp = await searchParams;
  const h = await getHospital();
  const tz = h.timezone;
  const money = (v) => formatMoney(v, h.currency, h.locale);
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab : "invoices";
  const summary = await getBillingSummary(tz);
  const today = todayInTz(tz);

  return (
    <>
      <PageHeader title="Billing & Payments" description="Invoices, payments, refunds and outstanding balances."
        actions={can(session, "billing:create") && <Button variant="primary" icon={FilePlus2} href="/billing/new">New invoice</Button>} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <MetricCard label="Outstanding balance" value={money(summary.outstanding)} icon={Wallet} tone="warning" hint={`${summary.outstandingCount} open invoice${summary.outstandingCount === 1 ? "" : "s"}`} href="/billing?tab=outstanding" />
        <MetricCard label="Collected today" value={money(summary.collectedToday)} icon={Banknote} tone="success" hint={`${summary.paymentsToday} payment${summary.paymentsToday === 1 ? "" : "s"}`} href={`/billing?tab=payments&from=${today}&to=${today}`} />
        <MetricCard label="Refunded today" value={money(summary.refundedToday)} icon={Undo2} tone="info" hint={`${summary.refundsToday} refund${summary.refundsToday === 1 ? "" : "s"}`} />
        <MetricCard label="Draft invoices" value={summary.drafts} icon={FileClock} tone="primary" hint="Not yet issued" href="/billing?status=DRAFT" />
      </div>

      <p className="text-[12.5px] text-muted mb-4 flex items-start gap-1.5">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        Online card payments are not processed by this system (no payment provider is configured). “Card” records a payment taken on a card terminal.
      </p>

      <div className="card">
        <LinkTabs tabs={TABS} active={tab} baseHref="/billing" />
        {tab === "invoices" && <InvoicesTab sp={sp} tz={tz} money={money} canCreate={can(session, "billing:create")} />}
        {tab === "outstanding" && <OutstandingTab sp={sp} tz={tz} money={money} />}
        {tab === "payments" && <PaymentsTab sp={sp} tz={tz} money={money} />}
      </div>
    </>
  );
}

const invLink = (r) => <Link href={`/billing/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.invoiceNo}</Link>;
const patientCell = (p) => (
  <div className="min-w-0 text-right sm:text-left">
    <Link href={`/patients/${p.id}`} className="font-medium hover:text-primary">{p.firstName} {p.lastName}</Link>
    <div className="text-xs text-muted font-mono">{p.mrn}</div>
  </div>
);

async function InvoicesTab({ sp, tz, money, canCreate }) {
  const q = invoiceListQuery.parse({ ...sp, sort: sp.sort || "createdAt" });
  if (q.status && q.status !== "OPEN" && !INVOICE_STATUSES.includes(q.status)) q.status = undefined;
  const { rows, meta } = await listInvoices(q, tz);
  const params = { tab: "invoices", q: q.q, status: q.status, from: q.from, to: q.to, sort: q.sort, dir: q.dir };
  const filtered = q.q || q.status || q.from || q.to;
  return (
    <>
      <FilterBar placeholder="Search invoice no., patient name or MRN…" dateRange
        filters={[{ name: "status", label: "Status", options: [{ value: "OPEN", label: "Open (unpaid balance)" }, ...INVOICE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))] }]} />
      <DataTable path="/billing" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Invoices"
        empty={<EmptyState title={filtered ? "No invoices match these filters" : "No invoices yet"} description={filtered ? "Try a different search or clear the filters." : "Create an invoice from a patient's unbilled charges."}
          action={canCreate && !filtered && <Button variant="primary" icon={FilePlus2} href="/billing/new">New invoice</Button>} />}
        columns={[
          { key: "invoiceNo", label: "Invoice", sortable: true, render: invLink },
          { key: "patient", label: "Patient", render: (r) => patientCell(r.patient) },
          { key: "createdAt", label: "Created", sortable: true, render: (r) => formatDate(r.createdAt, tz) },
          { key: "issuedAt", label: "Issued", sortable: true, render: (r) => (r.issuedAt ? formatDate(r.issuedAt, tz) : <span className="text-subtle">—</span>) },
          { key: "total", label: "Total", sortable: true, align: "right", render: (r) => money(r.total) },
          { key: "paid", label: "Paid (net)", align: "right", render: (r) => money(D(r.amountPaid).minus(r.amountRefunded)) },
          { key: "balance", label: "Balance", sortable: true, align: "right", render: (r) => <span className={["ISSUED", "PARTIALLY_PAID"].includes(r.status) && D(r.balance).gt(0) ? "font-semibold text-ink" : "text-muted"}>{money(r.balance)}</span> },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      <Pagination path="/billing" params={params} meta={meta} />
    </>
  );
}

async function OutstandingTab({ sp, tz, money }) {
  const q = listQuery.parse(sp);
  const bucket = AGEING_BUCKETS.includes(sp.bucket) ? sp.bucket : undefined;
  const now = new Date();
  const [ageing, { rows, meta }] = await Promise.all([getAgeing(now), listOutstanding({ ...q, bucket }, now)]);
  const params = { tab: "outstanding", q: q.q, bucket };
  const tones = { "0-30": "border-l-success", "31-60": "border-l-warning", "61-90": "border-l-[#ea580c]", "90+": "border-l-danger" };
  const total = ageing.reduce((s, a) => s.plus(a.total), D(0));
  return (
    <>
      <div className="p-4 border-b border-border">
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-[13.5px] font-semibold">Ageing by days since issue</h2>
          <p className="text-[12.5px] text-muted">Total outstanding <span className="font-semibold text-ink tabular">{money(total)}</span></p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ageing.map((a) => {
            const active = bucket === a.bucket;
            return (
              <Link key={a.bucket} href={buildHref("/billing", { tab: "outstanding", q: q.q }, { bucket: active ? undefined : a.bucket })} aria-current={active ? "true" : undefined}
                className={`block rounded-lg border border-border border-l-4 ${tones[a.bucket]} p-3 transition-shadow hover:shadow-[var(--shadow-md)] ${active ? "bg-primary-soft ring-1 ring-primary/30" : "bg-surface"}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{a.bucket} days</p>
                <p className="text-[18px] font-bold tabular mt-0.5">{money(a.total)}</p>
                <p className="text-xs text-subtle">{a.count} invoice{a.count === 1 ? "" : "s"}{active ? " · filtered" : ""}</p>
              </Link>
            );
          })}
        </div>
      </div>
      <FilterBar placeholder="Search invoice no., patient name or MRN…"
        filters={[{ name: "bucket", label: "Age", options: AGEING_BUCKETS.map((b) => ({ value: b, label: `${b} days` })) }]} />
      <DataTable rows={rows} caption="Outstanding invoices"
        empty={<EmptyState title={bucket || q.q ? "No outstanding invoices match" : "Nothing outstanding"} description={bucket || q.q ? "Try another age bucket or search." : "All issued invoices are fully settled."} />}
        columns={[
          { key: "invoiceNo", label: "Invoice", render: invLink },
          { key: "patient", label: "Patient", render: (r) => patientCell(r.patient) },
          { key: "phone", label: "Phone", render: (r) => r.patient.phone || "—" },
          { key: "issuedAt", label: "Issued", render: (r) => formatDate(r.issuedAt, tz) },
          { key: "days", label: "Age", align: "right", render: (r) => <Badge tone={r.days > 90 ? "danger" : r.days > 60 ? "warning" : r.days > 30 ? "info" : "neutral"} plain>{r.days} d</Badge> },
          { key: "total", label: "Total", align: "right", render: (r) => money(r.total) },
          { key: "balance", label: "Balance", align: "right", render: (r) => <span className="font-semibold">{money(r.balance)}</span> },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      <Pagination path="/billing" params={params} meta={meta} />
    </>
  );
}

async function PaymentsTab({ sp, tz, money }) {
  const q = paymentListQuery.parse(sp);
  const settings = await getBillingSettings();
  const methods = [...settings.paymentMethods, "INSURANCE"];
  if (q.method && !methods.includes(q.method)) q.method = undefined;
  const { rows, meta, sum } = await listPayments(q, tz);
  const params = { tab: "payments", q: q.q, method: q.method, from: q.from, to: q.to };
  const filtered = q.q || q.method || q.from || q.to;
  return (
    <>
      <FilterBar placeholder="Search receipt no., invoice no., patient or reference…" dateRange
        filters={[{ name: "method", label: "Method", options: methods.map((m) => ({ value: m, label: methodLabel(m) })) }]} />
      <DataTable rows={rows} caption="Payments"
        empty={<EmptyState title={filtered ? "No payments match these filters" : "No payments recorded yet"} description={filtered ? "Try a different search, method or date range." : "Payments recorded against invoices appear here."} />}
        columns={[
          { key: "receiptNo", label: "Receipt", render: (r) => <span className="font-mono text-[12.5px] font-semibold">{r.receiptNo}</span> },
          { key: "receivedAt", label: "Received", render: (r) => formatDateTime(r.receivedAt, tz) },
          { key: "invoice", label: "Invoice", render: (r) => invLink(r.invoice) },
          { key: "patient", label: "Patient", render: (r) => <span>{r.invoice.patient.firstName} {r.invoice.patient.lastName} <span className="text-xs text-muted font-mono">{r.invoice.patient.mrn}</span></span> },
          { key: "method", label: "Method", render: (r) => <Badge tone={r.method === "INSURANCE" ? "teal" : "neutral"} plain>{methodLabel(r.method)}</Badge> },
          { key: "reference", label: "Reference", render: (r) => r.reference || "—" },
          { key: "receivedBy", label: "Received by", render: (r) => r.receivedBy },
          { key: "amount", label: "Amount", align: "right", render: (r) => <span className="font-semibold">{money(r.amount)}</span> },
          { key: "print", label: "", render: (r) => <Link href={`/billing/receipts/${r.id}/print`} className="btn btn-ghost btn-sm" aria-label={`Print receipt ${r.receiptNo}`}><Printer size={14} aria-hidden /> Receipt</Link> },
        ]} />
      {meta.total > 0 && (
        <div className="flex justify-end px-4 py-2.5 border-t border-border text-[13px] text-muted">
          {filtered ? "Filtered" : "All"} payments total&nbsp;<span className="font-semibold text-ink tabular">{money(sum)}</span>
        </div>
      )}
      <Pagination path="/billing" params={params} meta={meta} />
    </>
  );
}
