import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { getClaimDetail } from "@/lib/services/insurance";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { formatMoney, D } from "@/lib/utils/money";
import { formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { CLAIM_TRANSITIONS } from "@/lib/validation/insurance";
import { serialize } from "@/lib/utils/serialize";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { InsuranceBanner } from "@/components/insurance/InsuranceBanner";
import { ClaimStatusBadge } from "@/components/insurance/ClaimStatusBadge";
import { ClaimActions } from "@/components/insurance/ClaimActions";
import { InsuranceDocUpload } from "@/components/insurance/InsuranceDocUpload";

export const metadata = { title: "Insurance claim" };

const STEPS = ["SUBMITTED", "DECIDED", "PAID"];

export default async function ClaimPage({ params }) {
  const session = await requirePageSession("insurance:read");
  const { id } = await params;
  const c = await getClaimDetail(id);
  if (!c) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const money = (v) => formatMoney(v, h.currency, h.locale);
  await audit({ userId: session.user.id, action: "claim.view", entityType: "InsuranceClaim", entityId: c.id });
  const manage = can(session, "insurance:manage");
  const billing = can(session, "billing:read");
  const inv = c.invoice;
  const stage = c.status === "SUBMITTED" ? 0 : c.status === "PAID" ? 2 : 1;
  const terminal = (CLAIM_TRANSITIONS[c.status] || []).length === 0;

  return (
    <>
      <div className="mb-5">
        <Link href="/insurance" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-2"><ArrowLeft size={14} aria-hidden /> Insurance & Claims</Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight font-mono">{c.claimNo}</h1>
              <ClaimStatusBadge status={c.status} />
            </div>
            <p className="text-[13.5px] text-muted mt-1">{c.policy.provider.name} · policy <span className="font-mono">{c.policy.policyNumber}</span> · submitted {formatDateTime(c.submittedAt ?? c.createdAt, tz)}</p>
          </div>
          {manage && !terminal && (
            <ClaimActions claim={serialize({ id: c.id, claimNo: c.claimNo, status: c.status, claimAmount: c.claimAmount, approvedAmount: c.approvedAmount })}
              invoiceBalance={inv.balance.toString()} invoiceStatus={inv.status} currency={h.currency} locale={h.locale} />
          )}
        </div>
      </div>
      <InsuranceBanner />

      <ol className="card p-4 mb-5 grid grid-cols-3 gap-2" aria-label="Claim progress">
        {STEPS.map((s, i) => {
          const done = i < stage || (i === stage && c.status === "PAID");
          const current = i === stage && c.status !== "PAID";
          const text = i === 1 ? (c.status === "REJECTED" ? "Rejected" : c.status === "PARTIALLY_APPROVED" ? "Partially approved" : stage >= 1 ? "Approved" : "Insurer decision") : i === 0 ? "Submitted" : "Settled";
          const bad = i === 1 && c.status === "REJECTED";
          return (
            <li key={s} className="flex items-center gap-2 min-w-0" aria-current={current ? "step" : undefined}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${bad ? "bg-danger text-white" : done || i < stage ? "bg-success text-white" : current ? "bg-primary text-white" : "bg-neutral-soft text-muted"}`}>{i + 1}</span>
              <span className={`text-[13px] truncate ${current || done ? "font-semibold" : "text-muted"}`}>{text}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5 min-w-0">
          <Card title="Claim">
            <dl className="dl-grid">
              <div><dt>Claim amount</dt><dd className="tabular font-semibold">{money(c.claimAmount)}</dd></div>
              <div><dt>Approved amount</dt><dd className="tabular">{c.approvedAmount != null ? money(c.approvedAmount) : "—"}</dd></div>
              <div><dt>Settled to invoice</dt><dd className="tabular">{c.settlement ? `${money(c.settlement.amount)} · ${c.settlement.receiptNo}` : "—"}</dd></div>
              <div><dt>Status</dt><dd><ClaimStatusBadge status={c.status} /></dd></div>
              {c.rejectionReason && <div className="col-span-full"><dt>Rejection reason</dt><dd>{c.rejectionReason}</dd></div>}
              {c.settlement && c.approvedAmount != null && D(c.settlement.amount).lt(c.approvedAmount) && (
                <div className="col-span-full"><dt>Note</dt><dd className="text-warning">The settlement was capped at the invoice balance ({money(c.settlement.amount)} of {money(c.approvedAmount)} approved).</dd></div>
              )}
            </dl>
          </Card>

          <Card title="Supporting documents" description="Patient documents filed under “Insurance”." noPadding
            actions={manage && <InsuranceDocUpload patientId={inv.patient.id} />}>
            {c.documents.length === 0 ? <EmptyState icon={FileText} title="No insurance documents" description="Upload claim forms, pre-authorisations or insurer correspondence (PDF or image)." /> : (
              <ul className="divide-y divide-border">
                {c.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline inline-flex items-center gap-2 min-w-0"><FileText size={15} aria-hidden className="shrink-0" /><span className="truncate">{d.originalName}</span></a>
                    <span className="text-xs text-subtle whitespace-nowrap">{(d.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(d.createdAt, tz)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Invoice">
            <dl className="space-y-2 text-[13.5px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">Invoice</dt><dd>{billing ? <Link className="font-mono text-primary hover:underline" href={`/billing/${inv.id}`}>{inv.invoiceNo}</Link> : <span className="font-mono">{inv.invoiceNo}</span>}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd><StatusBadge status={inv.status} /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Total</dt><dd className="tabular">{money(inv.total)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Balance</dt><dd className="tabular font-semibold">{money(inv.balance)}</dd></div>
              {inv.payments.length > 0 && <div className="flex justify-between gap-3"><dt className="text-muted">Insurance payments</dt><dd className="tabular">{money(inv.payments.reduce((s, p) => s.plus(p.amount), D(0)))}</dd></div>}
            </dl>
          </Card>
          <Card title="Patient & policy">
            <dl className="space-y-2.5 text-[13.5px]">
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Patient</dt><dd><Link href={`/patients/${inv.patient.id}`} className="text-primary hover:underline">{inv.patient.firstName} {inv.patient.lastName}</Link> <span className="text-xs text-muted font-mono">{inv.patient.mrn}</span></dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Provider</dt><dd>{c.policy.provider.name}{c.policy.provider.phone ? <span className="text-muted"> · {c.policy.provider.phone}</span> : null}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Coverage</dt><dd>{formatDateOnly(c.policy.coverageStart)} – {formatDateOnly(c.policy.coverageEnd)}</dd></div>
              {c.policy.coverageNotes && <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</dt><dd className="text-muted">{c.policy.coverageNotes}</dd></div>}
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}
