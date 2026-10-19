import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Clock, MapPin, Stethoscope } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { getProcedure, getProcedureActivity } from "@/lib/services/procedures";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { titleCase } from "@/lib/validation/inpatient";
import { ageFromDob, formatDateTime, formatTime } from "@/lib/utils/time";
import { formatMoney } from "@/lib/utils/money";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { ProcedureChecklist } from "@/components/procedures/ProcedureChecklist";
import { ProcedureActions } from "@/components/procedures/ProcedureActions";
import { ProcedureNotes } from "@/components/procedures/ProcedureNotes";

export const metadata = { title: "Procedure" };

function describe(a) {
  const m = a.metadata || {};
  switch (a.action) {
    case "procedure.schedule": return "Procedure scheduled";
    case "procedure.update": return `Booking updated${m.fields?.length ? ` (${m.fields.join(", ")})` : ""}${m.checklistReset ? " — checklist reset" : ""}`;
    case "procedure.checklist": return `Pre-procedure checklist confirmed${m.confirmedByName ? ` by ${m.confirmedByName}` : ""}`;
    case "procedure.status": return `Status ${titleCase(m.from)} → ${titleCase(m.to)}${m.reason ? ` — ${m.reason}` : ""}`;
    case "procedure.notes": return "Planning notes updated";
    default: return a.action;
  }
}

export default async function ProcedurePage({ params }) {
  const session = await requirePageSession("procedures:read");
  const { id } = await params;
  const p = await getProcedure(id);
  if (!p) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const activity = await getProcedureActivity(p.id);
  await audit({ userId: session.user.id, action: "procedure.view", entityType: "Procedure", entityId: p.id });
  const canManage = can(session, "procedures:manage");
  const checklistLog = [...activity].reverse().find((a) => a.action === "procedure.checklist");
  const cancelLog = p.status === "CANCELLED" ? [...activity].reverse().find((a) => a.action === "procedure.status" && a.metadata?.to === "CANCELLED") : null;
  const pt = p.patient;
  const age = ageFromDob(pt.dateOfBirth);
  const active = ["SCHEDULED", "IN_PROGRESS"].includes(p.status);

  return (
    <>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[21px] font-bold tracking-tight">{p.name}</h1>
              <StatusBadge status={p.status} />
            </div>
            <p className="text-[13px] text-muted mt-0.5">
              <span className="font-mono font-semibold text-ink">{p.procedureNo}</span> · {pt.firstName} {pt.lastName} · {can(session, "patients:read") ? <Link className="hover:text-primary" href={`/patients/${pt.id}`}>{pt.mrn}</Link> : pt.mrn} · {age != null ? `${age} y` : "Age unknown"} · {pt.sex === "UNKNOWN" ? "Sex not recorded" : pt.sex.toLowerCase()}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted">
              <span className="inline-flex items-center gap-1"><Clock size={13} aria-hidden />{formatDateTime(p.scheduledStart, tz)}–{formatTime(p.scheduledEnd, tz)}</span>
              <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{p.theatre.name}</span>
              <span className="inline-flex items-center gap-1"><Stethoscope size={13} aria-hidden />{p.surgeon.name}</span>
            </div>
          </div>
          <ProcedureActions procedure={{ id: p.id, procedureNo: p.procedureNo, status: p.status, checklistComplete: p.checklistComplete }} canManage={canManage} />
        </div>
        {pt.medicalAlerts && (
          <div className="mt-4 rounded-lg bg-warning-soft border border-warning/30 px-3 py-2 text-[13px] text-warning font-medium flex items-start gap-2" role="note">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {pt.medicalAlerts}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-2">Allergies</p>
          <div className="flex flex-wrap gap-2">
            {pt.allergies.length === 0 ? <span className="text-[13px] text-muted">No known allergies recorded</span> : pt.allergies.map((al) => (
              <span key={al.id} className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft text-danger text-[12.5px] font-semibold px-2.5 h-7">{al.substance}{al.reaction ? ` — ${al.reaction}` : ""} <span className="text-[11px] font-medium opacity-80">({al.severity.toLowerCase()})</span></span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card title="Pre-procedure checklist" description="All items must be confirmed before the procedure can start.">
            <ProcedureChecklist procedureId={p.id} complete={p.checklistComplete} status={p.status} canEdit={canManage}
              confirmedBy={checklistLog?.metadata?.confirmedByName || checklistLog?.user?.name} confirmedAt={checklistLog ? formatDateTime(checklistLog.createdAt, tz) : null} />
          </Card>
          <Card title="Planning notes">
            <ProcedureNotes procedureId={p.id} notes={p.notes} editable={canManage && active} />
          </Card>
          <Card title="Post-operative notes">
            {p.postOpNotes ? <p className="text-[13.5px] whitespace-pre-wrap">{p.postOpNotes}</p>
              : <p className="text-[13px] text-muted">{p.status === "IN_PROGRESS" ? "Recorded when the procedure is completed." : p.status === "CANCELLED" ? "Procedure was cancelled." : "Available once the procedure is completed."}</p>}
            {cancelLog?.metadata?.reason && <p className="mt-3 text-[13px]"><span className="text-muted">Cancellation reason:</span> {cancelLog.metadata.reason}</p>}
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Booking">
            <dl className="dl-grid">
              <div><dt>Theatre</dt><dd>{p.theatre.name}</dd></div>
              <div><dt>Surgeon</dt><dd>{p.surgeon.name}{p.surgeon.specialty && <span className="block text-xs text-muted">{p.surgeon.specialty}</span>}</dd></div>
              <div><dt>Start</dt><dd>{formatDateTime(p.scheduledStart, tz)}</dd></div>
              <div><dt>End</dt><dd>{formatDateTime(p.scheduledEnd, tz)}</dd></div>
              <div><dt>Charge</dt><dd className="tabular">{formatMoney(p.charge, h.currency, h.locale)}</dd></div>
              <div><dt>Booked</dt><dd>{formatDateTime(p.createdAt, tz)}</dd></div>
            </dl>
          </Card>
          <Card title="Activity" noPadding>
            {activity.length === 0 ? <EmptyState title="No activity" /> : (
              <ol className="timeline p-5">
                {activity.map((a) => (
                  <li key={a.id} className="timeline-item">
                    <p className="text-[13px] font-medium">{describe(a)}</p>
                    <p className="text-xs text-subtle">{a.user?.name || "System"} · {formatDateTime(a.createdAt, tz)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
