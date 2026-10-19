import Link from "next/link";
import { Plus, CalendarDays, Scissors, Play, CheckCircle2 } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQuery, dateString } from "@/lib/validation/common";
import { PROCEDURE_STATUSES } from "@/lib/validation/procedures";
import { titleCase } from "@/lib/validation/inpatient";
import { listDaySchedule, listProcedures, listTheatres } from "@/lib/services/procedures";
import { getHospital } from "@/lib/services/settings";
import { todayInTz, formatDateTime, formatTime, formatDate, zonedToUtc } from "@/lib/utils/time";
import { formatMoney } from "@/lib/utils/money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { LinkTabs } from "@/components/ui/Tabs";
import { FilterBar } from "@/components/ui/FilterBar";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { MetricCard } from "@/components/ui/MetricCard";
import { TheatreTimeline } from "@/components/procedures/TheatreTimeline";
import { TheatreManager } from "@/components/procedures/TheatreManager";
import { DayNav } from "@/components/procedures/DayNav";

export const metadata = { title: "Operating theatre" };

export default async function ProceduresPage({ searchParams }) {
  const session = await requirePageSession("procedures:read");
  const sp = await searchParams;
  const tab = ["schedule", "all", "theatres"].includes(sp.tab) ? sp.tab : "schedule";
  const h = await getHospital();
  const canManage = can(session, "procedures:manage");
  const theatres = await listTheatres();
  return (
    <>
      <PageHeader title="Operating theatre" description="Theatre schedule, pre-procedure checklist and procedure documentation."
        actions={canManage && <Button variant="primary" icon={Plus} href="/procedures/new">Schedule procedure</Button>} />
      <div className="card">
        <LinkTabs baseHref="/procedures" active={tab} tabs={[{ key: "schedule", label: "Day schedule" }, { key: "all", label: "All procedures" }, { key: "theatres", label: "Theatres", count: theatres.length }]} />
        {tab === "schedule" && <Schedule sp={sp} h={h} theatres={theatres} />}
        {tab === "all" && <AllProcedures sp={sp} h={h} theatres={theatres} />}
        {tab === "theatres" && <TheatreManager theatres={theatres} canManage={canManage} />}
      </div>
    </>
  );
}

async function Schedule({ sp, h, theatres }) {
  const tz = h.timezone;
  const today = todayInTz(tz);
  const date = dateString.safeParse(sp.date).success ? sp.date : today;
  const theatreId = theatres.some((t) => t.id === sp.theatreId) ? sp.theatreId : undefined;
  const status = PROCEDURE_STATUSES.includes(sp.status) ? sp.status : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const rows = await listDaySchedule(date, { theatreId, status, q }, tz);
  const shownTheatres = theatreId ? theatres.filter((t) => t.id === theatreId) : theatres;
  const count = (s) => rows.filter((r) => r.status === s).length;
  return (
    <>
      <div className="px-4 pt-3"><DayNav date={date} today={today} label={formatDate(zonedToUtc(date, "12:00", tz), tz)} /></div>
      <FilterBar placeholder="Search procedure, no. or patient…"
        filters={[
          { name: "theatreId", label: "Theatre", options: theatres.map((t) => ({ value: t.id, label: t.name })) },
          { name: "status", label: "Status", options: PROCEDURE_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) },
        ]} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-border">
        <MetricCard label="Booked" value={rows.length} icon={CalendarDays} tone="primary" />
        <MetricCard label="Scheduled" value={count("SCHEDULED")} icon={Scissors} tone="info" />
        <MetricCard label="In progress" value={count("IN_PROGRESS")} icon={Play} tone="warning" />
        <MetricCard label="Completed" value={count("COMPLETED")} icon={CheckCircle2} tone="success" />
      </div>
      <TheatreTimeline date={date} theatres={shownTheatres} procedures={rows} tz={tz} />
      <div className="border-t border-border">
        <DataTable rows={rows} caption="Procedures for the day"
          empty={<EmptyState icon={Scissors} title="No procedures on this day" description="Use “Schedule procedure” to book a theatre slot." />}
          columns={[
            { key: "time", label: "Time", render: (p) => <span className="tabular font-semibold">{formatTime(p.scheduledStart, tz)}–{formatTime(p.scheduledEnd, tz)}</span> },
            { key: "no", label: "No.", render: (p) => <Link className="font-mono text-[12.5px] text-primary font-semibold hover:underline" href={`/procedures/${p.id}`}>{p.procedureNo}</Link> },
            { key: "name", label: "Procedure", render: (p) => <span className="font-medium">{p.name}</span> },
            { key: "patient", label: "Patient", render: (p) => <span>{p.patient.firstName} {p.patient.lastName}<span className="block text-xs text-muted">{p.patient.mrn}</span></span> },
            { key: "theatre", label: "Theatre", render: (p) => p.theatre.name },
            { key: "surgeon", label: "Surgeon", render: (p) => p.surgeon.name },
            { key: "check", label: "Checklist", render: (p) => (p.checklistComplete ? <StatusBadge status="COMPLETED" label="Done" /> : p.status === "SCHEDULED" ? <StatusBadge status="PENDING" label="Pending" /> : "—") },
            { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} /> },
          ]} />
      </div>
    </>
  );
}

async function AllProcedures({ sp, h, theatres }) {
  const tz = h.timezone;
  const parsed = listQuery.safeParse({ ...sp, sort: sp.sort || "scheduledStart" });
  const q = parsed.success ? parsed.data : listQuery.parse({ sort: "scheduledStart" });
  const theatreId = theatres.some((t) => t.id === sp.theatreId) ? sp.theatreId : undefined;
  const status = PROCEDURE_STATUSES.includes(sp.status) ? sp.status : undefined;
  const { rows, meta } = await listProcedures({ ...q, status, theatreId }, tz);
  const params = { tab: "all", q: q.q, status, theatreId, from: q.from, to: q.to, sort: q.sort, dir: q.dir };
  return (
    <>
      <FilterBar placeholder="Search procedure, no. or patient…" dateRange
        filters={[
          { name: "theatreId", label: "Theatre", options: theatres.map((t) => ({ value: t.id, label: t.name })) },
          { name: "status", label: "Status", options: PROCEDURE_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) },
        ]} />
      <DataTable path="/procedures" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Procedures"
        empty={<EmptyState icon={Scissors} title="No procedures match" description="Adjust the filters or date range." />}
        columns={[
          { key: "procedureNo", label: "No.", sortable: true, render: (p) => <Link className="font-mono text-[12.5px] text-primary font-semibold hover:underline" href={`/procedures/${p.id}`}>{p.procedureNo}</Link> },
          { key: "scheduledStart", label: "Scheduled", sortable: true, render: (p) => `${formatDateTime(p.scheduledStart, tz)}–${formatTime(p.scheduledEnd, tz)}` },
          { key: "name", label: "Procedure", sortable: true, render: (p) => <span className="font-medium">{p.name}</span> },
          { key: "patient", label: "Patient", render: (p) => <span>{p.patient.firstName} {p.patient.lastName}<span className="block text-xs text-muted">{p.patient.mrn}</span></span> },
          { key: "theatre", label: "Theatre", render: (p) => p.theatre.name },
          { key: "surgeon", label: "Surgeon", render: (p) => p.surgeon.name },
          { key: "charge", label: "Charge", align: "right", render: (p) => formatMoney(p.charge, h.currency, h.locale) },
          { key: "status", label: "Status", render: (p) => <StatusBadge status={p.status} /> },
        ]} />
      <Pagination path="/procedures" params={params} meta={meta} />
    </>
  );
}
