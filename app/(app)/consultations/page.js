import Link from "next/link";
import { Users, Megaphone, Stethoscope, CheckCircle2, ClipboardList, AlertTriangle } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQueue, listEncounters } from "@/lib/services/encounters";
import { listDoctorOptions, isSuperAdmin } from "@/lib/services/appointments";
import { getHospital } from "@/lib/services/settings";
import { encounterListQuery } from "@/lib/validation/encounters";
import { typeLabel } from "@/lib/validation/appointments";
import { ageFromDob, formatDate, formatDateTime, formatTime, todayInTz } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { LinkTabs } from "@/components/ui/Tabs";
import { DataTable, Pagination, buildHref } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { cn } from "@/lib/utils/cn";
import { QueueActions } from "@/components/clinical/QueueActions";
import { NewEncounterButton } from "@/components/clinical/NewEncounterButton";
import { WalkInButton } from "@/components/appointments/WalkInButton";

export const metadata = { title: "OPD & Consultations" };

export default async function ConsultationsPage({ searchParams }) {
  const session = await requirePageSession(["encounters:create", "clinical:read", "appointments:update"]);
  const sp = await searchParams;
  const h = await getHospital();
  const tz = h.timezone;
  const today = todayInTz(tz);
  const clinical = can(session, "clinical:read");
  const canQueue = can(session, "appointments:read");
  const isDoctor = !!session.doctorId;
  const scope = isDoctor && sp.scope !== "all" ? "mine" : "all";
  const doctorFilter = scope === "mine" ? session.doctorId : (typeof sp.doctorId === "string" && sp.doctorId) || undefined;

  const tabs = [
    canQueue && { key: "queue", label: "Today's queue" },
    clinical && { key: "drafts", label: scope === "mine" ? "My drafts" : "Open drafts" },
    clinical && { key: "finalized", label: "Recently finalized" },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab : tabs[0]?.key;
  const [doctors, bookable] = await Promise.all([listDoctorOptions({ all: tab !== "queue" }), can(session, "appointments:create") ? listDoctorOptions() : []]);
  const scopeParam = isDoctor ? scope : undefined;
  const baseParams = { tab, scope: scopeParam, doctorId: scope === "mine" ? undefined : doctorFilter, q: sp.q };

  let body = null;
  if (tab === "queue") {
    const all = await listQueue({ date: today, doctorId: doctorFilter, includeDone: true });
    const showDone = sp.show === "all";
    const term = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase();
    const rows = all
      .filter((r) => showDone || ["WAITING", "CALLED", "IN_CONSULTATION"].includes(r.status))
      .filter((r) => !term || `${r.appointment.patient.firstName} ${r.appointment.patient.lastName}`.toLowerCase().includes(term) || r.appointment.patient.mrn.toLowerCase().includes(term) || String(r.tokenNumber) === term.replace("#", ""))
      .sort((a, b) => (a.status === "IN_CONSULTATION" ? -1 : 0) - (b.status === "IN_CONSULTATION" ? -1 : 0) || a.tokenNumber - b.tokenNumber);
    const count = (s) => all.filter((r) => r.status === s).length;
    const perms = { vitals: can(session, "vitals:create"), call: can(session, "appointments:update"), clinical };
    const multiDoctor = !doctorFilter;
    body = (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-border bg-surface-2/50">
          <MetricCard label="Waiting" value={count("WAITING")} icon={Users} tone="warning" />
          <MetricCard label="Called" value={count("CALLED")} icon={Megaphone} tone="info" />
          <MetricCard label="In consultation" value={count("IN_CONSULTATION")} icon={Stethoscope} tone="primary" />
          <MetricCard label="Seen today" value={count("DONE")} icon={CheckCircle2} tone="success" hint={count("LEFT") ? `${count("LEFT")} left without being seen` : undefined} />
        </div>
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border text-[12.5px]">
          <span className="text-muted">Queue for {formatDate(new Date(), tz)} · ordered by token</span>
          <Link className="font-semibold text-primary hover:underline" href={buildHref("/consultations", baseParams, { show: showDone ? undefined : "all" })}>{showDone ? "Hide completed" : `Show completed (${count("DONE") + count("LEFT")})`}</Link>
        </div>
        <DataTable rows={rows} caption="OPD queue"
          empty={<EmptyState icon={Users} title={term ? "No queued patients match your search" : "No patients waiting"} description="Checked-in appointments and walk-ins appear here in token order." />}
          columns={[
            { key: "token", label: "Token", render: (r) => <span className={cn("inline-flex items-center justify-center min-w-9 h-9 px-2 rounded-lg text-[15px] font-bold tabular", r.status === "IN_CONSULTATION" ? "bg-primary text-white" : r.status === "CALLED" ? "bg-info-soft text-info" : "bg-warning-soft text-warning")}>{r.tokenNumber}</span> },
            { key: "patient", label: "Patient", render: (r) => {
              const p = r.appointment.patient;
              const age = ageFromDob(p.dateOfBirth);
              return (
                <div className="min-w-0 text-left">
                  <span className="font-medium">{p.firstName} {p.lastName}</span>
                  {clinical && p._count.allergies > 0 && <Badge tone="danger" plain className="ml-2">Allergy</Badge>}
                  <span className="block text-xs text-muted"><span className="font-mono">{p.mrn}</span>{age != null ? ` · ${age} y` : ""}{p.sex !== "UNKNOWN" ? ` · ${p.sex[0]}` : ""}</span>
                </div>
              );
            } },
            ...(multiDoctor ? [{ key: "doctor", label: "Doctor", render: (r) => `Dr. ${r.appointment.doctor.staff.firstName} ${r.appointment.doctor.staff.lastName}` }] : []),
            { key: "appt", label: "Appointment", render: (r) => (
              <span className="whitespace-nowrap">
                {can(session, "appointments:read") ? <Link href={`/appointments/${r.appointment.id}`} className="font-mono text-[12px] text-primary hover:underline">{r.appointment.appointmentNo}</Link> : r.appointment.appointmentNo}
                <span className="block text-xs text-muted">{typeLabel(r.appointment.type)} · {formatTime(r.appointment.startsAt, tz)}</span>
              </span>
            ) },
            { key: "wait", label: "Checked in", render: (r) => {
              if (!r.appointment.checkedInAt) return "—";
              const mins = r.waitingMinutes ?? 0;
              return <span className="whitespace-nowrap tabular">{formatTime(r.appointment.checkedInAt, tz)}{["WAITING", "CALLED"].includes(r.status) && <span className={cn("block text-xs", mins >= 45 ? "text-danger font-semibold" : "text-muted")}>waiting {mins} min</span>}</span>;
            } },
            { key: "vitals", label: "Vitals", render: (r) => (r.vitalsRecorded ? <Badge tone="success" plain>Recorded</Badge> : <span className="text-xs text-subtle">Not yet</span>) },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "actions", label: "", render: (r) => (
              <QueueActions entry={{ id: r.id, status: r.status, token: r.tokenNumber, appointmentId: r.appointment.id, appointmentStatus: r.appointment.status, encounterId: r.appointment.encounter?.id ?? null, patientName: `${r.appointment.patient.firstName} ${r.appointment.patient.lastName}` }}
                perms={{ ...perms, start: can(session, "encounters:create") && ((session.doctorId && session.doctorId === r.appointment.doctorId) || isSuperAdmin(session)) }} />
            ) },
          ]} />
      </>
    );
  } else if (tab === "drafts" || tab === "finalized") {
    const parsed = encounterListQuery.safeParse({ ...sp, status: tab === "drafts" ? "DRAFT" : "FINALIZED", doctorId: doctorFilter });
    const q = parsed.success ? parsed.data : encounterListQuery.parse({ status: tab === "drafts" ? "DRAFT" : "FINALIZED", doctorId: doctorFilter });
    const { rows, meta } = await listEncounters(q, tz);
    const params = { ...baseParams, from: q.from, to: q.to };
    body = (
      <>
        <DataTable rows={rows} caption={tab === "drafts" ? "Draft consultations" : "Finalized consultations"}
          empty={<EmptyState icon={ClipboardList} title={tab === "drafts" ? "No incomplete documentation" : "No finalized consultations"} description={tab === "drafts" ? "Draft consultations that still need documentation or signing appear here." : "Signed consultations appear here."} />}
          columns={[
            { key: "no", label: "Encounter", render: (r) => <Link className="font-mono text-[12.5px] text-primary font-semibold hover:underline" href={`/consultations/${r.id}`}>{r.encounterNo}</Link> },
            { key: "patient", label: "Patient", render: (r) => <Link href={`/consultations/${r.id}`} className="font-medium hover:text-primary">{r.patient.firstName} {r.patient.lastName}<span className="block text-xs text-muted font-mono">{r.patient.mrn}</span></Link> },
            ...(scope === "mine" ? [] : [{ key: "doctor", label: "Doctor", render: (r) => `Dr. ${r.doctor.staff.firstName} ${r.doctor.staff.lastName}` }]),
            { key: "date", label: tab === "drafts" ? "Started" : "Finalized", render: (r) => <span className="tabular whitespace-nowrap">{formatDateTime(tab === "drafts" ? r.startedAt : r.finalizedAt, tz)}</span> },
            tab === "drafts"
              ? { key: "missing", label: "Outstanding", render: (r) => {
                const missing = [!r.assessment?.trim() && "assessment", r._count.diagnoses === 0 && "diagnosis"].filter(Boolean);
                return missing.length ? <span className="inline-flex items-center gap-1 text-warning text-[12.5px] font-medium"><AlertTriangle size={13} aria-hidden />Needs {missing.join(" & ")}</span> : <Badge tone="success" plain>Ready to sign</Badge>;
              } }
              : { key: "rx", label: "Prescriptions", align: "right", render: (r) => r._count.prescriptions },
            { key: "appt", label: "Visit", render: (r) => (r.appointment ? <span className="font-mono text-[12px]">{r.appointment.appointmentNo}</span> : <span className="text-xs text-muted">Ad-hoc</span>) },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        <Pagination path="/consultations" params={params} meta={meta} />
      </>
    );
  }

  const doctorOptions = doctors.map((d) => ({ value: d.id, label: `Dr. ${d.name}` }));
  return (
    <>
      <PageHeader title="OPD & Consultations" description="Today's outpatient queue, consultation drafts and signed visits."
        actions={<>
          {can(session, "appointments:create") && <WalkInButton doctors={bookable} canEditFee={can(session, "billing:discount")} currency={h.currency} defaultDoctorId={session.doctorId || undefined} />}
          {can(session, "encounters:create") && session.doctorId && <NewEncounterButton />}
        </>} />

      {isDoctor && (
        <nav className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5 shadow-sm mb-3" aria-label="Whose patients">
          {[{ key: "mine", label: "My patients" }, { key: "all", label: "All doctors" }].map((s) => (
            <Link key={s.key} href={buildHref("/consultations", { tab }, { scope: s.key })} aria-current={scope === s.key ? "page" : undefined}
              className={cn("inline-flex items-center h-8 px-3 rounded-md text-[13px] font-medium", scope === s.key ? "bg-primary-soft text-primary-ink" : "text-muted hover:text-ink")}>{s.label}</Link>
          ))}
        </nav>
      )}

      {tabs.length === 0 ? (
        <div className="card"><EmptyState title="Nothing to show" description="Your role can't view the queue or clinical records." /></div>
      ) : (
        <div className="card overflow-hidden">
          <LinkTabs tabs={tabs} active={tab} baseHref={buildHref("/consultations", { scope: scopeParam })} />
          <FilterBar placeholder={tab === "queue" ? "Find patient, MRN or token…" : "Search encounter no., patient name or MRN…"} dateRange={tab === "finalized"}
            filters={scope === "mine" ? [] : [{ name: "doctorId", label: "Doctor", options: doctorOptions }]} />
          {body}
        </div>
      )}
    </>
  );
}
