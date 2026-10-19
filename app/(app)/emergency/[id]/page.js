import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Ambulance, Footprints, Share2, BedDouble } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getVisit, getVisitActivity, getTriageCategories } from "@/lib/services/emergency";
import { userNames } from "@/lib/services/admissions";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { erLabel, formatWait, isErActive, minutesSince } from "@/lib/validation/emergency";
import { ageFromDob, formatDateTime } from "@/lib/utils/time";
import { Card } from "@/components/ui/Card";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { TriageChip } from "@/components/emergency/TriageChip";
import { TimeSince } from "@/components/emergency/TimeSince";
import { ErVisitActions } from "@/components/emergency/ErVisitActions";

export const metadata = { title: "ER visit" };

const ARRIVAL_ICON = { AMBULANCE: Ambulance, WALK_IN: Footprints, REFERRED: Share2 };

function describe(a, names, categories) {
  const m = a.metadata || {};
  const cat = (k) => (k ? `${k}${categories.find((c) => c.key === k) ? ` (${categories.find((c) => c.key === k).label})` : ""}` : "—");
  switch (a.action) {
    case "emergency.register": return `Arrival registered (${erLabel(m.arrivalMode || "")})${m.quickRegistered ? " — patient quick-registered" : ""}`;
    case "emergency.triage": return `Triaged as ${cat(m.to)}`;
    case "emergency.retriage": return `Re-triaged ${cat(m.from)} → ${cat(m.to)}`;
    case "emergency.assign": return `Clinician assigned: ${names[m.to] || "—"}${m.from ? ` (was ${names[m.from] || "—"})` : ""}`;
    case "emergency.status": return `Status ${erLabel(m.from)} → ${erLabel(m.to)}${m.clinicianId ? ` · ${names[m.clinicianId] || ""}` : ""}`;
    case "emergency.disposition": return `Disposition: ${erLabel(m.to)}`;
    case "emergency.ambulance_dispatched": return "Ambulance dispatched for this visit";
    default: return a.action;
  }
}

export default async function ErVisitPage({ params }) {
  const session = await requirePageSession("emergency:read");
  const { id } = await params;
  const v = await getVisit(id);
  if (!v) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const [categories, activity] = await Promise.all([getTriageCategories(), getVisitActivity(v.id)]);
  const names = await userNames(activity.flatMap((a) => [a.metadata?.to, a.metadata?.from, a.metadata?.clinicianId]).filter((x) => typeof x === "string"));
  await audit({ userId: session.user.id, action: "emergency.view", entityType: "EmergencyVisit", entityId: v.id });
  const openAdmission = v.status === "ADMITTED" && can(session, "admissions:read")
    ? await prisma.admission.findFirst({ where: { patientId: v.patientId, admittedAt: { gte: v.arrivedAt } }, orderBy: { admittedAt: "asc" }, select: { id: true, admissionNo: true, status: true } })
    : null;
  const p = v.patient;
  const age = ageFromDob(p.dateOfBirth);
  const ArrIcon = ARRIVAL_ICON[v.arrivalMode] || Footprints;
  const active = isErActive(v.status);
  const minutes = minutesSince(v.arrivedAt);

  return (
    <>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[21px] font-bold tracking-tight">{p.firstName} {p.lastName}</h1>
              <StatusBadge status={v.status} />
              <TriageChip category={v.triageCategory} categories={categories} size="lg" />
            </div>
            <p className="text-[13px] text-muted mt-0.5">
              <span className="font-mono font-semibold text-ink">{v.visitNo}</span> · {can(session, "patients:read") ? <Link className="hover:text-primary" href={`/patients/${p.id}`}>{p.mrn}</Link> : p.mrn} · {age != null ? `${age} y` : "Age unknown"} · {p.sex === "UNKNOWN" ? "Sex not recorded" : p.sex.toLowerCase()}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted">
              <span className="inline-flex items-center gap-1"><ArrIcon size={13} aria-hidden />{erLabel(v.arrivalMode)}</span>
              <span>Arrived {formatDateTime(v.arrivedAt, tz)}</span>
              {active && <span>Waiting <TimeSince since={new Date(v.arrivedAt).toISOString()} initial={formatWait(minutes)} /></span>}
              {v.clinicianName && <span>Clinician: <span className="text-ink font-medium">{v.clinicianName}</span></span>}
            </div>
          </div>
          <ErVisitActions visit={{ id: v.id, status: v.status, patientId: v.patientId, triageCategory: v.triageCategory, initialObservations: v.initialObservations, assignedClinicianId: v.assignedClinicianId }}
            categories={categories} canManage={can(session, "emergency:manage")} canAdmit={can(session, "admissions:create")} />
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
              <span key={al.id} className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft text-danger text-[12.5px] font-semibold px-2.5 h-7">{al.substance}{al.reaction ? ` — ${al.reaction}` : ""} <span className="text-[11px] font-medium opacity-80">({al.severity.toLowerCase()})</span></span>
            ))}
          </div>
        </div>
      </div>

      {v.status === "ADMITTED" && (
        <div className="rounded-xl border border-primary/30 bg-primary-soft p-4 mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] inline-flex items-center gap-2"><BedDouble size={16} aria-hidden className="text-primary" />
            {openAdmission ? <>Ward admission <Link className="font-semibold text-primary hover:underline" href={`/admissions/${openAdmission.id}`}>{openAdmission.admissionNo}</Link> created ({openAdmission.status.toLowerCase()}).</> : "Disposition is “admitted” — the ward admission has not been created yet."}
          </p>
          {!openAdmission && can(session, "admissions:create") && <Button variant="primary" href={`/admissions/new?patientId=${v.patientId}`}>Create admission</Button>}
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card title="Presentation">
            <dl className="space-y-4">
              <div><dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Presenting complaint</dt><dd className="text-[13.5px] mt-1 whitespace-pre-wrap">{v.presentingComplaint}</dd></div>
              <div><dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Initial observations</dt><dd className="text-[13.5px] mt-1 whitespace-pre-wrap">{v.initialObservations || <span className="text-muted">Not recorded</span>}</dd></div>
              <div className="dl-grid">
                <div><dt>Triage</dt><dd><TriageChip category={v.triageCategory} categories={categories} /></dd></div>
                <div><dt>Triaged by</dt><dd>{v.triagedByName || "—"}</dd></div>
                <div><dt>Treating clinician</dt><dd>{v.clinicianName || "—"}</dd></div>
              </div>
              {v.disposition !== null && !active && (
                <div><dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Disposition — {erLabel(v.status)}</dt><dd className="text-[13.5px] mt-1 whitespace-pre-wrap">{v.disposition || <span className="text-muted">No notes</span>}</dd></div>
              )}
            </dl>
          </Card>
          <Card title="Ambulance dispatches" noPadding actions={can(session, "ambulance:manage") && active && <Button size="sm" href={`/ambulances?tab=dispatches&dispatchFor=${v.id}`} icon={Ambulance}>Dispatch</Button>}>
            {v.dispatches.length === 0 ? <EmptyState icon={Ambulance} title="No dispatches linked" /> : (
              <ul className="divide-y divide-border">
                {v.dispatches.map((d) => (
                  <li key={d.id} className="px-4 py-3 text-[13px] flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{d.ambulance.vehicleNo}</span><Badge tone="neutral" plain>{d.ambulance.type}</Badge><StatusBadge status={d.status} />
                    <span className="text-muted">{d.pickupAddress} → {d.destination}</span>
                    <span className="text-xs text-subtle">{formatDateTime(d.dispatchedAt, tz)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Activity log" noPadding>
          {activity.length === 0 ? <EmptyState title="No activity" /> : (
            <ol className="timeline p-5">
              {activity.map((a) => (
                <li key={a.id} className="timeline-item">
                  <p className="text-[13px] font-medium">{describe(a, names, categories)}</p>
                  <p className="text-xs text-subtle">{a.user?.name || "System"} · {formatDateTime(a.createdAt, tz)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
