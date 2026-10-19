import Link from "next/link";
import { UserPlus, Siren, ClipboardList, Stethoscope, Timer, Ambulance, Footprints, Share2 } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQuery } from "@/lib/validation/common";
import { ER_ACTIVE_STATUSES, formatWait, erLabel, minutesSince } from "@/lib/validation/emergency";
import { getActiveBoard, listClosedVisits, getTriageCategories } from "@/lib/services/emergency";
import { getHospital } from "@/lib/services/settings";
import { ageFromDob, formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { FilterBar } from "@/components/ui/FilterBar";
import { LinkTabs } from "@/components/ui/Tabs";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { TriageChip } from "@/components/emergency/TriageChip";
import { LiveRefresh } from "@/components/emergency/LiveRefresh";
import { TimeSince } from "@/components/emergency/TimeSince";

export const metadata = { title: "Emergency" };

const COLUMN = {
  WAITING_TRIAGE: { title: "Waiting for triage", icon: ClipboardList },
  TRIAGED: { title: "Triaged — waiting", icon: Timer },
  UNDER_TREATMENT: { title: "Under treatment", icon: Stethoscope },
};
const ARRIVAL_ICON = { AMBULANCE: Ambulance, WALK_IN: Footprints, REFERRED: Share2 };

export default async function EmergencyPage({ searchParams }) {
  const session = await requirePageSession("emergency:read");
  const sp = await searchParams;
  const view = sp.view === "closed" ? "closed" : "board";
  const h = await getHospital();
  const tz = h.timezone;
  const categories = await getTriageCategories();
  const canManage = can(session, "emergency:manage");

  return (
    <>
      <PageHeader title="Emergency department" description="Arrivals, staff-assigned triage, treatment and disposition."
        actions={<>
          {can(session, "ambulance:read") && <Button icon={Ambulance} href="/ambulances">Ambulances</Button>}
          {canManage && <Button variant="primary" icon={UserPlus} href="/emergency/new">Register arrival</Button>}
        </>} />
      {view === "board"
        ? <Board sp={sp} tz={tz} categories={categories} canManage={canManage} />
        : <Closed sp={sp} tz={tz} categories={categories} />}
    </>
  );
}

async function Board({ sp, tz, categories, canManage }) {
  const status = ER_ACTIVE_STATUSES.includes(sp.status) ? sp.status : undefined;
  const category = categories.some((c) => c.key === sp.category) ? sp.category : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const rows = await getActiveBoard({ q, status, category });
  const all = await getActiveBoard({});
  const count = (s) => all.filter((r) => r.status === s).length;
  const longest = all.filter((r) => r.status !== "UNDER_TREATMENT").reduce((m, r) => Math.max(m, minutesSince(r.arrivedAt)), 0);
  const rank = Object.fromEntries(categories.map((c, i) => [c.key, i]));
  const columns = (status ? [status] : ER_ACTIVE_STATUSES).map((s) => ({
    status: s,
    rows: rows.filter((r) => r.status === s).sort((a, b) => (s === "WAITING_TRIAGE" ? 0 : (rank[a.triageCategory] ?? 99) - (rank[b.triageCategory] ?? 99)) || new Date(a.arrivedAt) - new Date(b.arrivedAt)),
  }));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <MetricCard label="In department" value={all.length} icon={Siren} tone="danger" />
        <MetricCard label="Waiting for triage" value={count("WAITING_TRIAGE")} icon={ClipboardList} tone="warning" />
        <MetricCard label="Under treatment" value={count("UNDER_TREATMENT")} icon={Stethoscope} tone="info" />
        <MetricCard label="Longest wait (untreated)" value={all.length ? formatWait(longest) : "—"} icon={Timer} tone="primary" />
      </div>
      <div className="card mb-5">
        <LinkTabs param="view" baseHref="/emergency" active="board" tabs={[{ key: "board", label: "Live board", count: all.length }, { key: "closed", label: "Closed visits" }]} />
        <FilterBar placeholder="Search visit no., patient, MRN or complaint…"
          filters={[
            { name: "status", label: "Status", options: ER_ACTIVE_STATUSES.map((s) => ({ value: s, label: erLabel(s) })) },
            { name: "category", label: "Triage", options: categories.map((c) => ({ value: c.key, label: `${c.key} — ${c.label}` })) },
          ]}>
          <LiveRefresh seconds={30} />
        </FilterBar>
        <div className="px-4 py-2.5 flex flex-wrap gap-2 items-center text-xs text-muted">
          <span>Triage categories:</span>
          {categories.map((c) => <TriageChip key={c.key} category={c.key} categories={categories} />)}
        </div>
      </div>
      <div className={`grid gap-4 ${columns.length === 1 ? "" : "lg:grid-cols-3"}`}>
        {columns.map((col) => {
          const meta = COLUMN[col.status];
          const Icon = meta.icon;
          return (
            <section key={col.status} className="card flex flex-col min-w-0" aria-labelledby={`col-${col.status}`}>
              <header className="card-header">
                <h2 id={`col-${col.status}`} className="card-title inline-flex items-center gap-2"><Icon size={16} aria-hidden className="text-muted" />{meta.title}</h2>
                <span className="badge badge-neutral badge-plain tabular">{col.rows.length}</span>
              </header>
              {col.rows.length === 0 ? <EmptyState title="No patients" description={col.status === "WAITING_TRIAGE" && canManage ? "New arrivals appear here." : undefined} /> : (
                <ul className="p-3 space-y-2.5">
                  {col.rows.map((r) => {
                    const color = categories.find((c) => c.key === r.triageCategory)?.color || "var(--color-border-strong)";
                    const ArrIcon = ARRIVAL_ICON[r.arrivalMode] || Footprints;
                    const age = ageFromDob(r.patient.dateOfBirth);
                    const mins = minutesSince(r.arrivedAt);
                    return (
                      <li key={r.id}>
                        <Link href={`/emergency/${r.id}`} className="block rounded-lg border border-border bg-surface hover:shadow-[var(--shadow-md)] transition-shadow p-3 border-l-[5px]" style={{ borderLeftColor: color }}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-[13.5px] truncate">{r.patient.firstName} {r.patient.lastName}</p>
                              <p className="text-xs text-muted">{r.visitNo} · {r.patient.mrn} · {age != null ? `${age} y` : "age ?"} {r.patient.sex !== "UNKNOWN" ? r.patient.sex[0] : ""}</p>
                            </div>
                            <div className="text-right text-[12.5px] shrink-0">
                              <TimeSince since={new Date(r.arrivedAt).toISOString()} initial={formatWait(mins)} warnAfterMin={r.status === "UNDER_TREATMENT" ? undefined : 60} />
                              <p className="text-[11px] text-subtle">since arrival</p>
                            </div>
                          </div>
                          <p className="text-[13px] mt-1.5 line-clamp-2">{r.presentingComplaint}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <TriageChip category={r.triageCategory} categories={categories} />
                            <span className="inline-flex items-center gap-1 text-xs text-muted"><ArrIcon size={13} aria-hidden />{erLabel(r.arrivalMode)}</span>
                            {r.clinicianName && <span className="inline-flex items-center gap-1 text-xs text-muted"><Stethoscope size={13} aria-hidden />{r.clinicianName}</span>}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

async function Closed({ sp, tz, categories }) {
  const parsed = listQuery.safeParse(sp);
  const q = parsed.success ? parsed.data : listQuery.parse({});
  const closedStatuses = ["DISCHARGED", "ADMITTED", "TRANSFERRED", "LEFT_WITHOUT_BEING_SEEN"];
  const status = closedStatuses.includes(sp.status) ? sp.status : undefined;
  const { rows, meta } = await listClosedVisits({ ...q, status }, tz);
  const params = { view: "closed", q: q.q, status, from: q.from, to: q.to };
  return (
    <div className="card">
      <LinkTabs param="view" baseHref="/emergency" active="closed" tabs={[{ key: "board", label: "Live board" }, { key: "closed", label: "Closed visits", count: meta.total }]} />
      <FilterBar placeholder="Search visit no., patient, MRN or complaint…" dateRange
        filters={[{ name: "status", label: "Disposition", options: closedStatuses.map((s) => ({ value: s, label: erLabel(s) })) }]} />
      <DataTable rows={rows} caption="Closed emergency visits"
        empty={<EmptyState title="No closed visits" description="Visits appear here once a disposition is recorded." />}
        columns={[
          { key: "no", label: "Visit", render: (r) => <Link className="font-mono text-[12.5px] text-primary font-semibold hover:underline" href={`/emergency/${r.id}`}>{r.visitNo}</Link> },
          { key: "patient", label: "Patient", render: (r) => <span><span className="font-medium">{r.patient.firstName} {r.patient.lastName}</span><span className="block text-xs text-muted">{r.patient.mrn}</span></span> },
          { key: "arr", label: "Arrived", render: (r) => formatDateTime(r.arrivedAt, tz) },
          { key: "triage", label: "Triage", render: (r) => <TriageChip category={r.triageCategory} categories={categories} /> },
          { key: "complaint", label: "Complaint", render: (r) => <span className="line-clamp-2 max-w-[280px] inline-block">{r.presentingComplaint}</span> },
          { key: "closed", label: "Closed", render: (r) => formatDateTime(r.updatedAt, tz) },
          { key: "status", label: "Disposition", render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      <Pagination path="/emergency" params={params} meta={meta} />
    </div>
  );
}
