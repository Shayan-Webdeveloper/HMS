import Link from "next/link";
import { Hourglass, BadgeCheck, XCircle, Landmark } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQuery } from "@/lib/validation/common";
import { CLAIM_STATUSES, policyListQuery } from "@/lib/validation/insurance";
import { listClaims, getClaimsSummary, listPolicies, listProviders, activeProviders } from "@/lib/services/insurance";
import { getHospital } from "@/lib/services/settings";
import { formatMoney } from "@/lib/utils/money";
import { formatDate, formatDateOnly, todayInTz } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { LinkTabs } from "@/components/ui/Tabs";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { InsuranceBanner } from "@/components/insurance/InsuranceBanner";
import { ClaimStatusBadge, PolicyStatusBadge } from "@/components/insurance/ClaimStatusBadge";
import { NewClaimButton } from "@/components/insurance/NewClaimButton";
import { AddPolicyButton, PolicyRowActions } from "@/components/insurance/PolicyControls";
import { AddProviderButton, ProviderRowActions } from "@/components/insurance/ProviderControls";

export const metadata = { title: "Insurance & Claims" };

const TABS = [{ key: "claims", label: "Claims" }, { key: "policies", label: "Policies" }, { key: "providers", label: "Providers" }];
const label = (s) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export default async function InsurancePage({ searchParams }) {
  const session = await requirePageSession("insurance:read");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab : "claims";
  const h = await getHospital();
  const manage = can(session, "insurance:manage");
  const money = (v) => formatMoney(v, h.currency, h.locale);
  const providers = manage && tab === "policies" ? await activeProviders() : [];

  return (
    <>
      <PageHeader title="Insurance & Claims" description="Insurance providers, patient policies and claim tracking."
        actions={manage && (tab === "claims" ? <NewClaimButton currency={h.currency} locale={h.locale} /> : tab === "policies" ? <AddPolicyButton providers={providers} /> : <AddProviderButton />)} />
      <InsuranceBanner />
      {tab === "claims" && <ClaimSummary money={money} />}
      <div className="card">
        <LinkTabs tabs={TABS} active={tab} baseHref="/insurance" />
        {tab === "claims" && <ClaimsTab sp={sp} tz={h.timezone} money={money} billing={can(session, "billing:read")} />}
        {tab === "policies" && <PoliciesTab sp={sp} tz={h.timezone} manage={manage} providers={providers} />}
        {tab === "providers" && <ProvidersTab sp={sp} manage={manage} />}
      </div>
    </>
  );
}

async function ClaimSummary({ money }) {
  const s = await getClaimsSummary();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
      <MetricCard label="Awaiting insurer decision" value={money(s.submitted.amount)} icon={Hourglass} tone="warning" hint={`${s.submitted.count} submitted`} href="/insurance?status=SUBMITTED" />
      <MetricCard label="Approved, awaiting payment" value={money(s.approved.amount)} icon={BadgeCheck} tone="primary" hint={`${s.approved.count} claim${s.approved.count === 1 ? "" : "s"}`} />
      <MetricCard label="Settled by insurers" value={money(s.paid.amount)} icon={Landmark} tone="success" hint={`${s.paid.count} paid`} href="/insurance?status=PAID" />
      <MetricCard label="Rejected" value={money(s.rejected.amount)} icon={XCircle} tone="danger" hint={`${s.rejected.count} claim${s.rejected.count === 1 ? "" : "s"}`} href="/insurance?status=REJECTED" />
    </div>
  );
}

async function ClaimsTab({ sp, tz, money, billing }) {
  const q = listQuery.parse(sp);
  if (q.status && !CLAIM_STATUSES.includes(q.status)) q.status = undefined;
  const { rows, meta } = await listClaims(q, tz);
  const params = { tab: "claims", q: q.q, status: q.status, from: q.from, to: q.to };
  const filtered = q.q || q.status || q.from || q.to;
  return (
    <>
      <FilterBar placeholder="Search claim, invoice, policy no., provider or patient…" dateRange
        filters={[{ name: "status", label: "Status", options: CLAIM_STATUSES.map((s) => ({ value: s, label: label(s) })) }]} />
      <DataTable rows={rows} caption="Insurance claims"
        empty={<EmptyState title={filtered ? "No claims match these filters" : "No claims yet"} description={filtered ? "Try a different search or status." : "Raise a claim from an issued invoice for a patient with an active policy."} />}
        columns={[
          { key: "claimNo", label: "Claim", render: (r) => <Link href={`/insurance/claims/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.claimNo}</Link> },
          { key: "patient", label: "Patient", render: (r) => <span>{r.invoice.patient.firstName} {r.invoice.patient.lastName} <span className="text-xs text-muted font-mono">{r.invoice.patient.mrn}</span></span> },
          { key: "invoice", label: "Invoice", render: (r) => (billing ? <Link href={`/billing/${r.invoice.id}`} className="font-mono text-[12.5px] hover:text-primary">{r.invoice.invoiceNo}</Link> : <span className="font-mono text-[12.5px]">{r.invoice.invoiceNo}</span>) },
          { key: "provider", label: "Provider / policy", render: (r) => <span>{r.policy.provider.name} <span className="text-xs text-muted">· {r.policy.policyNumber}</span></span> },
          { key: "submitted", label: "Submitted", render: (r) => formatDate(r.submittedAt ?? r.createdAt, tz) },
          { key: "claimAmount", label: "Claimed", align: "right", render: (r) => money(r.claimAmount) },
          { key: "approved", label: "Approved", align: "right", render: (r) => (r.approvedAmount != null ? money(r.approvedAmount) : "—") },
          { key: "status", label: "Status", render: (r) => <ClaimStatusBadge status={r.status} /> },
        ]} />
      <Pagination path="/insurance" params={params} meta={meta} />
    </>
  );
}

async function PoliciesTab({ sp, tz, manage, providers }) {
  const q = policyListQuery.parse(sp);
  if (q.status && !["ACTIVE", "EXPIRED", "INACTIVE"].includes(q.status)) q.status = undefined;
  const [{ rows, meta }, provs] = await Promise.all([listPolicies(q, tz), listProviders({ q: "", page: 1, pageSize: 100 })]);
  const params = { tab: "policies", q: q.q, status: q.status, providerId: q.providerId };
  const today = todayInTz(tz);
  const filtered = q.q || q.status || q.providerId;
  return (
    <>
      <FilterBar placeholder="Search policy no., provider or patient…"
        filters={[
          { name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active & in date" }, { value: "EXPIRED", label: "Expired" }, { value: "INACTIVE", label: "Inactive" }] },
          { name: "providerId", label: "Provider", options: provs.rows.map((p) => ({ value: p.id, label: p.name })) },
        ]} />
      <DataTable rows={rows} caption="Insurance policies"
        empty={<EmptyState title={filtered ? "No policies match these filters" : "No policies recorded"} description={filtered ? "Try a different search or filter." : "Add a patient's insurance policy to raise claims against it."} />}
        columns={[
          { key: "patient", label: "Patient", render: (r) => <Link href={`/patients/${r.patient.id}`} className="hover:text-primary"><span className="font-medium">{r.patient.firstName} {r.patient.lastName}</span> <span className="text-xs text-muted font-mono">{r.patient.mrn}</span></Link> },
          { key: "provider", label: "Provider", render: (r) => r.provider.name },
          { key: "policyNumber", label: "Policy no.", render: (r) => <span className="font-mono text-[12.5px]">{r.policyNumber}</span> },
          { key: "coverage", label: "Coverage", render: (r) => `${formatDateOnly(r.coverageStart)} – ${formatDateOnly(r.coverageEnd)}` },
          { key: "notes", label: "Notes", render: (r) => <span className="text-muted line-clamp-2 max-w-xs inline-block">{r.coverageNotes || "—"}</span> },
          { key: "claims", label: "Claims", align: "right", render: (r) => r._count.claims },
          { key: "status", label: "Status", render: (r) => <PolicyStatusBadge isActive={r.isActive} expired={r.coverageEnd.toISOString().slice(0, 10) < today} /> },
          ...(manage ? [{ key: "actions", label: "", render: (r) => <PolicyRowActions policy={serialize({ id: r.id, policyNumber: r.policyNumber, coverageStart: r.coverageStart, coverageEnd: r.coverageEnd, coverageNotes: r.coverageNotes, isActive: r.isActive, provider: r.provider, patient: r.patient })} providers={providers} /> }] : []),
        ]} />
      <Pagination path="/insurance" params={params} meta={meta} />
    </>
  );
}

async function ProvidersTab({ sp, manage }) {
  const q = listQuery.parse(sp);
  const { rows, meta } = await listProviders(q);
  const params = { tab: "providers", q: q.q, status: q.status };
  return (
    <>
      <FilterBar placeholder="Search providers by name, phone or email…"
        filters={[{ name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] }]} />
      <DataTable rows={rows} caption="Insurance providers"
        empty={<EmptyState title={q.q || q.status ? "No providers match" : "No providers yet"} description={q.q || q.status ? "Try a different search." : "Add the insurers and takaful operators you work with."} />}
        columns={[
          { key: "name", label: "Provider", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
          { key: "email", label: "Email", render: (r) => r.email || "—" },
          { key: "policies", label: "Policies", align: "right", render: (r) => r._count.policies },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
          ...(manage ? [{ key: "actions", label: "", render: (r) => <ProviderRowActions provider={{ id: r.id, name: r.name, phone: r.phone, email: r.email, isActive: r.isActive }} /> }] : []),
        ]} />
      <Pagination path="/insurance" params={params} meta={meta} />
    </>
  );
}
