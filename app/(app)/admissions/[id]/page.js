import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Phone, Droplet, BedDouble, FileText } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getAdmission, listVitals, listNotes, listAdministrations, listAdministrableItems, userNames } from "@/lib/services/admissions";
import { listWardOptions } from "@/lib/services/wards";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { formatLos, lengthOfStay, doctorName, titleCase } from "@/lib/validation/inpatient";
import { ageFromDob, formatDateTime, formatDate, toZonedDateString, toZonedTimeString } from "@/lib/utils/time";
import { formatMoney } from "@/lib/utils/money";
import { serialize } from "@/lib/utils/serialize";
import { LinkTabs } from "@/components/ui/Tabs";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState, ForbiddenState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { AdmissionActions } from "@/components/inpatient/AdmissionActions";
import { VitalsPanel } from "@/components/inpatient/VitalsPanel";
import { NotesPanel } from "@/components/inpatient/NotesPanel";
import { MarPanel } from "@/components/inpatient/MarPanel";
import { DischargeForm } from "@/components/inpatient/DischargePanel";

export const metadata = { title: "Admission" };

export default async function AdmissionPage({ params, searchParams }) {
  const session = await requirePageSession("admissions:read");
  const { id } = await params;
  const sp = await searchParams;
  const a = await getAdmission(id);
  if (!a) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const clinical = can(session, "clinical:read");
  const canDischarge = can(session, "admissions:discharge");
  const isOpen = a.status === "ADMITTED";
  await audit({ userId: session.user.id, action: "admission.view", entityType: "Admission", entityId: a.id });

  const tabs = [
    { key: "overview", label: "Overview" },
    clinical && { key: "vitals", label: "Vitals", count: a._count.vitals },
    clinical && { key: "notes", label: "Notes", count: a._count.notes },
    clinical && { key: "medications", label: "Medications", count: a._count.medAdministrations },
    ((isOpen && canDischarge) || (a.status === "DISCHARGED" && clinical)) && { key: "discharge", label: "Discharge" },
    can(session, "audit:read") && { key: "activity", label: "Activity" },
  ].filter(Boolean);
  const requested = typeof sp.tab === "string" ? sp.tab : "overview";
  const clinicalTabs = ["vitals", "notes", "medications"];
  const tab = tabs.some((t) => t.key === requested) ? requested : clinicalTabs.includes(requested) && !clinical ? "forbidden" : "overview";
  const current = a.bedAssignments.find((b) => !b.endedAt);
  const p = a.patient;
  const age = ageFromDob(p.dateOfBirth);
  const wards = isOpen && can(session, "admissions:transfer")
    ? serialize((await listWardOptions()).map((w) => ({ ...w, dailyRateLabel: formatMoney(w.dailyRate, h.currency, h.locale) })))
    : [];

  return (
    <>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
          <div className="flex gap-4 min-w-0">
            <div className="w-14 h-14 rounded-full bg-primary-soft text-primary-ink font-bold text-lg flex items-center justify-center shrink-0" aria-hidden>{p.firstName[0]}{p.lastName[0]}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[21px] font-bold tracking-tight">{p.firstName} {p.lastName}</h1>
                <StatusBadge status={a.status} />
              </div>
              <p className="text-[13px] text-muted mt-0.5">
                <span className="font-mono font-semibold text-ink">{a.admissionNo}</span> · <Link className="hover:text-primary" href={`/patients/${p.id}`}>{p.mrn}</Link> · {age != null ? `${age} y` : "Age unknown"} · {p.sex === "UNKNOWN" ? "Sex not recorded" : p.sex.toLowerCase()}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted">
                <span className="inline-flex items-center gap-1"><BedDouble size={13} aria-hidden />{current ? `${current.bed.ward.name} · ${current.bed.label}` : "No current bed"}</span>
                <span>LOS {formatLos(a.admittedAt, a.dischargedAt, tz)}</span>
                <span>{doctorName(a.doctor)}</span>
                {p.phone && <span className="inline-flex items-center gap-1"><Phone size={13} aria-hidden />{p.phone}</span>}
                {p.bloodGroup && <span className="inline-flex items-center gap-1"><Droplet size={13} aria-hidden />{p.bloodGroup}</span>}
              </div>
            </div>
          </div>
          <AdmissionActions admission={{ id: a.id, status: a.status, currentBedId: current?.bed.id ?? null, currentBedLabel: current ? `${current.bed.ward.code} · ${current.bed.label}` : null }}
            wards={wards} canTransfer={can(session, "admissions:transfer")} canDischarge={canDischarge} canClinical={clinical} />
        </div>
        {p.medicalAlerts && (
          <div className="mt-4 rounded-lg bg-warning-soft border border-warning/30 px-3 py-2 text-[13px] text-warning font-medium flex items-start gap-2" role="note">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {p.medicalAlerts}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-2">Allergies</p>
          <div className="flex flex-wrap gap-2">
            {p.allergies.length === 0 ? <span className="text-[13px] text-muted">No known allergies recorded</span> : p.allergies.map((al) => (
              <span key={al.id} className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft text-danger text-[12.5px] font-semibold px-2.5 h-7">
                {al.substance}{al.reaction ? ` — ${al.reaction}` : ""}<span className="text-[11px] font-medium opacity-80">({al.severity.toLowerCase()})</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <LinkTabs tabs={tabs} active={tab} baseHref={`/admissions/${a.id}`} />
        <TabContent tab={tab} a={a} tz={tz} session={session} isOpen={isOpen} current={current} clinical={clinical} h={h} />
      </div>
    </>
  );
}

async function TabContent({ tab, a, tz, session, isOpen, current, clinical, h }) {
  switch (tab) {
    case "forbidden":
      return <ForbiddenState />;
    case "overview": {
      const names = await userNames([a.createdById, ...a.bedAssignments.map((b) => b.assignedById)]);
      const los = lengthOfStay(a.admittedAt, a.dischargedAt, tz);
      return (
        <div className="grid lg:grid-cols-[1fr_340px]">
          <div className="p-5 space-y-6 min-w-0">
            <dl className="dl-grid">
              <div><dt>Admission no.</dt><dd className="font-mono">{a.admissionNo}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={a.status} /></dd></div>
              <div><dt>Admitted</dt><dd>{formatDateTime(a.admittedAt, tz)}</dd></div>
              <div><dt>{a.dischargedAt ? "Discharged" : "Expected discharge"}</dt><dd>{a.dischargedAt ? formatDateTime(a.dischargedAt, tz) : a.expectedDischargeAt ? formatDate(a.expectedDischargeAt, tz) : "—"}</dd></div>
              <div><dt>Length of stay</dt><dd>{los.days} day{los.days === 1 ? "" : "s"} <span className="text-muted">({los.hours} h)</span></dd></div>
              <div><dt>Admitting doctor</dt><dd>{doctorName(a.doctor)}{a.doctor.specialty ? <span className="block text-xs text-muted">{a.doctor.specialty} · {a.doctor.department?.name}</span> : null}</dd></div>
              <div><dt>Admitted by</dt><dd>{names[a.createdById] || "—"}</dd></div>
              <div><dt>Current bed</dt><dd>{current ? `${current.bed.ward.name} · ${current.bed.label}` : "—"}</dd></div>
            </dl>
            <div>
              <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-1">Reason for admission</h3>
              <p className="text-[13.5px] whitespace-pre-wrap">{a.reason}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Bed history</h3>
              <div className="table-wrap rounded-lg border border-border">
                <table className="table table-responsive">
                  <thead><tr><th>Ward</th><th>Bed</th><th>From</th><th>To</th><th className="num">Daily rate</th><th>End reason</th><th>Assigned by</th></tr></thead>
                  <tbody>
                    {a.bedAssignments.map((b) => (
                      <tr key={b.id}>
                        <td data-label="Ward">{b.bed.ward.name}</td>
                        <td data-label="Bed" className="font-mono">{b.bed.label}</td>
                        <td data-label="From">{formatDateTime(b.startedAt, tz)}</td>
                        <td data-label="To">{b.endedAt ? formatDateTime(b.endedAt, tz) : <Badge tone="primary">Current</Badge>}</td>
                        <td data-label="Daily rate" className="num">{formatMoney(b.bed.ward.dailyRate, h.currency, h.locale)}</td>
                        <td data-label="End reason">{b.reason || "—"}</td>
                        <td data-label="Assigned by">{names[b.assignedById] || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <aside className="border-t lg:border-t-0 lg:border-l border-border p-5 space-y-5">
            {clinical && <LatestVitals admissionId={a.id} tz={tz} />}
            <div>
              <h3 className="font-semibold mb-2 text-[13.5px]">Emergency contact</h3>
              {a.patient.emergencyContacts[0] ? <p className="text-[13px]">{a.patient.emergencyContacts[0].name} {a.patient.emergencyContacts[0].relationship && <span className="text-muted">({a.patient.emergencyContacts[0].relationship})</span>}<br /><span className="text-muted">{a.patient.emergencyContacts[0].phone}</span></p> : <p className="text-[13px] text-muted">Not recorded</p>}
            </div>
            {a.status === "DISCHARGED" && (
              <div>
                <h3 className="font-semibold mb-2 text-[13.5px]">Discharge</h3>
                <p className="text-[13px]">Condition: <span className="font-medium">{a.dischargeCondition || "—"}</span></p>
                {clinical && <Button className="mt-2" size="sm" icon={FileText} href={`/admissions/${a.id}/discharge-summary`}>Discharge summary</Button>}
              </div>
            )}
          </aside>
        </div>
      );
    }
    case "vitals": {
      const vitals = await listVitals(a.id);
      return <VitalsPanel admissionId={a.id} vitals={serialize(vitals)} canRecord={isOpen && can(session, "vitals:create")} tz={tz} />;
    }
    case "notes": {
      const notes = await listNotes(a.id, ["PROGRESS", "ROUND", "NURSING", "DISCHARGE", "GENERAL"]);
      return <NotesPanel admissionId={a.id} notes={serialize(notes)} canNursing={can(session, "nursing:create")} canClinician={can(session, "encounters:create")} isOpen={isOpen} tz={tz} />;
    }
    case "medications": {
      const [administrations, items] = await Promise.all([listAdministrations(a.id), listAdministrableItems(a.patientId)]);
      return <MarPanel admissionId={a.id} administrations={serialize(administrations)} items={serialize(items)} canRecord={can(session, "nursing:create")} isOpen={isOpen} tz={tz} />;
    }
    case "discharge": {
      if (isOpen) {
        const now = new Date();
        return (
          <div className="p-5 max-w-3xl">
            <DischargeForm admissionId={a.id} admissionNo={a.admissionNo} bedLabel={current ? `${current.bed.ward.code} · ${current.bed.label}` : null}
              defaultDate={toZonedDateString(now, tz)} defaultTime={toZonedTimeString(now, tz)} />
          </div>
        );
      }
      if (!clinical) return <ForbiddenState />;
      return (
        <div className="p-5 space-y-4 max-w-3xl">
          <dl className="dl-grid">
            <div><dt>Discharged</dt><dd>{formatDateTime(a.dischargedAt, tz)}</dd></div>
            <div><dt>Condition</dt><dd>{a.dischargeCondition || "—"}</dd></div>
            <div><dt>Length of stay</dt><dd>{formatLos(a.admittedAt, a.dischargedAt, tz)}</dd></div>
          </dl>
          <div>
            <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-1">Discharge summary</h3>
            <p className="text-[13.5px] whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-4">{a.dischargeSummary || "—"}</p>
          </div>
          <Button variant="primary" icon={FileText} href={`/admissions/${a.id}/discharge-summary`}>Printable discharge summary</Button>
        </div>
      );
    }
    case "activity": {
      const rows = await prisma.auditLog.findMany({ where: { entityType: "Admission", entityId: a.id }, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true } } } });
      if (!rows.length) return <EmptyState title="No activity recorded" />;
      return (
        <ol className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <code className="text-[12px] bg-surface-2 px-1.5 py-0.5 rounded">{r.action}</code>
              <span>{r.user?.name || "System"}</span>
              <span className="text-xs text-subtle">{formatDateTime(r.createdAt, tz)}</span>
              {r.metadata?.kind && <Badge tone="neutral" plain>{titleCase(r.metadata.kind)}</Badge>}
              {r.metadata?.reason && <span className="text-muted">Reason: {r.metadata.reason}</span>}
            </li>
          ))}
        </ol>
      );
    }
    default:
      return null;
  }
}

async function LatestVitals({ admissionId, tz }) {
  const v = await prisma.vitalSign.findFirst({ where: { admissionId }, orderBy: { recordedAt: "desc" } });
  return (
    <div>
      <h3 className="font-semibold mb-2 text-[13.5px]">Latest vitals {v && <span className="text-xs text-subtle font-normal">{formatDateTime(v.recordedAt, tz)}</span>}</h3>
      {!v ? <p className="text-[13px] text-muted">None recorded</p> : (
        <dl className="grid grid-cols-2 gap-2 text-[13px]">
          <div><dt className="text-muted text-xs">BP</dt><dd className="font-semibold tabular">{v.systolic ?? "—"}/{v.diastolic ?? "—"}</dd></div>
          <div><dt className="text-muted text-xs">Pulse</dt><dd className="font-semibold tabular">{v.pulse ?? "—"}</dd></div>
          <div><dt className="text-muted text-xs">Temp °C</dt><dd className="font-semibold tabular">{v.temperatureC?.toString() ?? "—"}</dd></div>
          <div><dt className="text-muted text-xs">SpO₂ %</dt><dd className="font-semibold tabular">{v.spo2 ?? "—"}</dd></div>
        </dl>
      )}
    </div>
  );
}

