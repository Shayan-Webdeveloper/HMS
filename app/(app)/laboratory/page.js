import Link from "next/link";
import { FlaskConical, TestTube, ClipboardCheck, CheckCircle2, Siren, Plus, BookOpen } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { labListQuery, LAB_STATUSES, LAB_STATUS_LABELS } from "@/lib/validation/lab";
import { listLabOrders, labWorklistCounts } from "@/lib/services/lab";
import { getHospital } from "@/lib/services/settings";
import { ageFromDob, formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { DataTable, Pagination, buildHref } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { StatusTabs } from "@/components/laboratory/StatusTabs";
import { AutoRefresh } from "@/components/laboratory/AutoRefresh";

export const metadata = { title: "Laboratory" };

const TAB_KEYS = ["ACTIVE", ...LAB_STATUSES, "ALL"];
const sexShort = (s) => (s && s !== "UNKNOWN" ? s[0] : "—");

export default async function LaboratoryPage({ searchParams }) {
  const session = await requirePageSession("lab:read");
  const sp = await searchParams;
  const parsed = labListQuery.safeParse(sp);
  const q = parsed.success ? parsed.data : labListQuery.parse({});
  const status = TAB_KEYS.includes(sp.status) ? sp.status : "ACTIVE";
  const h = await getHospital();
  const tz = h.timezone;
  const isDoctor = !!session.doctorId;

  const [{ rows, meta, sort }, counts] = await Promise.all([
    listLabOrders({ ...q, status }, tz, session),
    labWorklistCounts(tz, session, { mine: q.mine }),
  ]);
  const params = { q: q.q, status, priority: q.priority, mine: q.mine ? "1" : undefined, from: q.from, to: q.to, sort: sp.sort, dir: sp.dir };
  const filterParams = { q: q.q, priority: q.priority, mine: q.mine ? "1" : undefined, from: q.from, to: q.to };
  const tabs = TAB_KEYS.map((k) => ({
    key: k,
    label: k === "ACTIVE" ? "Active" : k === "ALL" ? "All" : LAB_STATUS_LABELS[k],
    count: k === "ACTIVE" ? counts.active : k === "ALL" ? counts.all : counts.status[k],
  }));
  const card = (statusKey, extra = {}) => buildHref("/laboratory", { ...filterParams, priority: undefined, status: statusKey, ...extra });

  return (
    <>
      <PageHeader title="Laboratory" description="Specimen collection, result entry, validation and release."
        actions={<>
          {can(session, "lab:manage") && <Button icon={BookOpen} href="/laboratory/catalog">Test catalogue</Button>}
          {can(session, "lab:order") && <Button variant="primary" icon={Plus} href="/laboratory/new">New lab order</Button>}
        </>} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
        <MetricCard label="Awaiting collection" value={counts.status.REQUESTED} icon={TestTube} tone="info" href={card("REQUESTED")} hint="Specimen not yet drawn" />
        <MetricCard label="In process" value={counts.status.SAMPLE_COLLECTED + counts.status.PROCESSING} icon={FlaskConical} tone="primary" href={card("PROCESSING")} hint={`${counts.status.SAMPLE_COLLECTED} collected · ${counts.status.PROCESSING} on bench`} />
        <MetricCard label="Awaiting validation" value={counts.status.AWAITING_VALIDATION} icon={ClipboardCheck} tone="warning" href={card("AWAITING_VALIDATION")} hint="Ready for sign-off" />
        <MetricCard label="Released today" value={counts.releasedToday} icon={CheckCircle2} tone="success" href={card("RELEASED")} hint={`${counts.orderedToday} ordered today`} />
        <MetricCard label="STAT / urgent open" value={counts.urgentOpen} icon={Siren} tone="danger" href={card("ACTIVE", { priority: counts.statOpen ? "STAT" : "URGENT" })} hint={`${counts.statOpen} STAT`} />
      </div>

      <div className="card">
        <StatusTabs tabs={tabs} active={status} path="/laboratory" params={filterParams} />
        <FilterBar placeholder="Search order no., specimen no., patient name or MRN…" dateRange
          filters={[
            { name: "priority", label: "Priority", options: [{ value: "STAT", label: "STAT" }, { value: "URGENT", label: "Urgent" }, { value: "ROUTINE", label: "Routine" }] },
            ...(isDoctor ? [{ name: "mine", label: "Ordered by", options: [{ value: "1", label: "Me" }] }] : []),
          ]} />
        <DataTable path="/laboratory" params={params} sort={sort} dir={q.dir} rows={rows} caption="Laboratory orders"
          empty={<EmptyState icon={FlaskConical} title={q.q || q.priority || q.from || q.to ? "No orders match your filters" : status === "ACTIVE" ? "The worklist is clear" : "No orders in this status"}
            description={q.q ? "Search by order number, specimen number, patient name, MRN or phone." : "New orders appear here as soon as they are placed."}
            action={can(session, "lab:order") && <Button variant="primary" icon={Plus} href="/laboratory/new">New lab order</Button>} />}
          columns={[
            { key: "orderNo", label: "Order", sortable: true, render: (r) => (
              <Link href={`/laboratory/${r.id}`} className={`inline-flex items-center gap-1.5 font-mono text-[12.5px] font-semibold hover:underline ${r.priority === "STAT" ? "text-danger" : "text-primary"}`}>
                {r.priority === "STAT" && <Siren size={13} aria-label="STAT" />}{r.orderNo}
              </Link>
            ) },
            { key: "patient", label: "Patient", render: (r) => (
              <div className="min-w-0">
                <Link href={`/laboratory/${r.id}`} className="font-medium hover:text-primary">{r.patient.firstName} {r.patient.lastName}</Link>
                <p className="text-xs text-muted"><span className="font-mono">{r.patient.mrn}</span> · {r.patient.dateOfBirth ? `${ageFromDob(r.patient.dateOfBirth)} y` : "—"} · {sexShort(r.patient.sex)}</p>
              </div>
            ) },
            { key: "tests", label: "Tests", render: (r) => (
              <span className="text-[13px]" title={r.items.map((i) => i.test.name).join(", ")}>
                {r.items.slice(0, 3).map((i) => i.test.code).join(", ")}{r.items.length > 3 && <span className="text-muted"> +{r.items.length - 3}</span>}
              </span>
            ) },
            { key: "doctor", label: "Ordered by", render: (r) => (r.doctor ? `Dr. ${r.doctor.staff.firstName} ${r.doctor.staff.lastName}` : "—") },
            { key: "createdAt", label: "Ordered", sortable: true, render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt, tz)}</span> },
            { key: "priority", label: "Priority", sortable: true, render: (r) => <StatusBadge status={r.priority} label={r.priority === "STAT" ? "STAT" : undefined} /> },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} label={LAB_STATUS_LABELS[r.status]} /> },
          ]} />
        <Pagination path="/laboratory" params={params} meta={meta} />
      </div>
      <div className="mt-3"><AutoRefresh seconds={60} /></div>
    </>
  );
}
