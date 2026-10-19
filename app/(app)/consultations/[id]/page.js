import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ShieldAlert, Lock, Printer, CalendarPlus, History, Ticket } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getEncounter, isEncounterAuthor, userNames } from "@/lib/services/encounters";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { SOAP_FIELDS, SOAP_LABELS } from "@/lib/validation/encounters";
import { typeLabel } from "@/lib/validation/appointments";
import { ageFromDob, formatDate, formatDateOnly, formatDateTime, todayInTz } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EncounterDocumentation } from "@/components/clinical/EncounterDocumentation";
import { DiagnosisPanel } from "@/components/clinical/DiagnosisPanel";
import { PrescriptionPanel } from "@/components/clinical/PrescriptionPanel";
import { OrdersPanel } from "@/components/clinical/OrdersPanel";
import { NotesPanel, AmendmentPanel } from "@/components/clinical/NotesPanel";
import { RecordVitalsButton } from "@/components/clinical/WorkspaceButtons";

export const metadata = { title: "Consultation" };

const v = (x) => (x == null ? "—" : x.toString());

export default async function EncounterWorkspacePage({ params }) {
  const session = await requirePageSession("clinical:read");
  const { id } = await params;
  const enc = await getEncounter(id);
  if (!enc) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  await audit({ userId: session.user.id, action: "encounter.view", entityType: "Encounter", entityId: enc.id });

  const names = await userNames([...enc.notes.map((n) => n.authorId), ...enc.vitals.map((x) => x.recordedById), enc.finalizedById]);
  const previous = await prisma.encounter.findMany({
    where: { patientId: enc.patientId, id: { not: enc.id }, status: "FINALIZED" }, orderBy: { startedAt: "desc" }, take: 5,
    select: { id: true, encounterNo: true, startedAt: true, diagnoses: { where: { isPrimary: true }, take: 1, select: { description: true } }, doctor: { select: { staff: { select: { lastName: true } } } } },
  });

  const draft = enc.status === "DRAFT";
  const isAuthor = isEncounterAuthor(enc, session);
  const canEdit = draft && isAuthor && can(session, "encounters:create");
  const p = enc.patient;
  const age = ageFromDob(p.dateOfBirth);
  const doctor = `Dr. ${enc.doctor.staff.firstName} ${enc.doctor.staff.lastName}`;
  const latest = enc.vitals[0];
  const generalNotes = enc.notes.filter((n) => n.kind !== "AMENDMENT").map((n) => ({ id: n.id, kind: n.kind, content: n.content, authorName: names[n.authorId] || "Unknown user", createdLabel: formatDateTime(n.createdAt, tz) }));
  const amendments = enc.notes.filter((n) => n.kind === "AMENDMENT").map((n) => ({ id: n.id, content: n.content, reason: n.reason, authorName: names[n.authorId] || "Unknown user", createdLabel: formatDateTime(n.createdAt, tz) }));
  const draftRx = enc.prescriptions.filter((r) => r.status === "DRAFT").length;
  const bookFollowUp = can(session, "appointments:create") ? `/appointments/new?patientId=${p.id}&doctorId=${enc.doctorId}&type=FOLLOW_UP` : null;
  const allergies = p.allergies.map((a) => ({ id: a.id, substance: a.substance, severity: a.severity, reaction: a.reaction }));

  return (
    <>
      {/* Patient banner */}
      <div className="card p-4 sm:p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
          <div className="flex gap-4 min-w-0">
            <div className="w-12 h-12 rounded-full bg-primary-soft text-primary-ink font-bold text-lg flex items-center justify-center shrink-0" aria-hidden>{p.firstName[0]}{p.lastName[0]}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[20px] font-bold tracking-tight">{p.firstName} {p.lastName}</h1>
                {can(session, "patients:read") && <Link href={`/patients/${p.id}`} className="text-[12.5px] font-semibold text-primary hover:underline">Open record</Link>}
              </div>
              <p className="text-[13px] text-muted mt-0.5">
                <span className="font-mono font-semibold text-ink">{p.mrn}</span> · {age != null ? `${age} y` : "Age unknown"} · {p.sex === "UNKNOWN" ? "Sex not recorded" : p.sex.toLowerCase()}
                {p.dateOfBirth && <> · DOB {formatDateOnly(p.dateOfBirth)}</>}{p.bloodGroup && <> · {p.bloodGroup}</>}
              </p>
              <p className="text-[12.5px] text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono font-semibold text-ink">{enc.encounterNo}</span><StatusBadge status={enc.status} />
                <span>{enc.type} · {doctor} · {enc.department.name}</span>
                <span>Started {formatDateTime(enc.startedAt, tz)}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button icon={Printer} href={`/consultations/${enc.id}/print`}>Print summary</Button>
            {bookFollowUp && !draft && <Button icon={CalendarPlus} href={`${bookFollowUp}${enc.followUpDate ? `&date=${enc.followUpDate.toISOString().slice(0, 10)}` : ""}`}>Book follow-up</Button>}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-2">Allergies</p>
          {allergies.length === 0 ? <p className="text-[13px] text-muted">No known allergies recorded</p> : (
            <ul className="flex flex-wrap gap-2" aria-label="Active allergies">
              {allergies.map((a) => (
                <li key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft text-danger text-[12.5px] font-semibold px-2.5 h-7 border border-danger/30">
                  <ShieldAlert size={13} aria-hidden />{a.substance}{a.reaction ? ` — ${a.reaction}` : ""}{a.severity !== "UNKNOWN" && <span className="font-normal">({a.severity.toLowerCase()})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {p.medicalAlerts && (
          <div className="mt-3 rounded-lg bg-warning-soft border border-warning/30 px-3 py-2 text-[13px] text-warning font-medium flex items-start gap-2" role="note">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {p.medicalAlerts}
          </div>
        )}
      </div>

      {!draft && (
        <div className="mb-5 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-[13.5px] text-success flex items-start gap-2" role="note">
          <Lock size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>{enc.status === "FINALIZED" ? <>Finalized {formatDateTime(enc.finalizedAt, tz)} by {names[enc.finalizedById] || doctor}. This record is read-only; corrections are added as amendments.</> : "This consultation was cancelled and is read-only."}</span>
        </div>
      )}
      {draft && !isAuthor && (
        <div className="mb-5 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-[13.5px] text-info" role="note">Draft consultation by {doctor}. Only the treating doctor can edit or sign it{can(session, "vitals:create") ? "; you can record vital signs." : "."}</div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5 min-w-0">
          <Card title="Clinical documentation" description={canEdit ? "Typed by the clinician. Save the draft regularly; finalize when complete." : undefined}>
            {canEdit ? (
              <EncounterDocumentation encounter={serialize({ id: enc.id, ...Object.fromEntries(SOAP_FIELDS.map((k) => [k, enc[k]])), followUpDate: enc.followUpDate })}
                canFinalize={can(session, "encounters:finalize") && isAuthor} diagnosesCount={enc.diagnoses.length} draftRxCount={draftRx} today={todayInTz(tz)} bookFollowUpHref={bookFollowUp} />
            ) : (
              <dl className="space-y-4">
                {SOAP_FIELDS.map((k) => (
                  <div key={k}>
                    <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{SOAP_LABELS[k]}</dt>
                    <dd className="text-[13.5px] mt-1 whitespace-pre-wrap">{enc[k] || <span className="text-subtle">Not recorded</span>}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Follow-up</dt>
                  <dd className="text-[13.5px] mt-1">{enc.followUpDate ? formatDateOnly(enc.followUpDate) : <span className="text-subtle">None</span>}</dd>
                </div>
              </dl>
            )}
          </Card>

          <Card title="Diagnoses" description="Entered by the clinician (free-text code + description). No diagnoses are suggested by the system.">
            <DiagnosisPanel encounterId={enc.id} diagnoses={serialize(enc.diagnoses)} canEdit={canEdit} />
          </Card>

          {(can(session, "prescriptions:read") || isAuthor) && (
            <Card title="Prescriptions" description={draft ? "Drafts become active and go to the pharmacy when the consultation is finalized." : undefined}>
              <PrescriptionPanel encounterId={enc.id} patientId={p.id} prescriptions={serialize(enc.prescriptions)} allergies={allergies}
                canPrescribe={draft && isAuthor && can(session, "prescriptions:create")} canCancel={can(session, "prescriptions:cancel")} canPrint />
            </Card>
          )}

          <Card title="Laboratory & imaging orders">
            <OrdersPanel encounterId={enc.id} patientId={p.id} currency={h.currency}
              labOrders={serialize(enc.labOrders.map((o) => ({ ...o, createdLabel: formatDateTime(o.createdAt, tz) })))}
              imagingStudies={serialize(enc.imagingStudies.map((s) => ({ ...s, createdLabel: formatDateTime(s.createdAt, tz) })))}
              canOrderLab={draft && isAuthor && can(session, "lab:order")} canOrderImaging={draft && isAuthor && can(session, "radiology:order")}
              canViewLab={can(session, "lab:read")} canViewImaging={can(session, "radiology:read")} />
          </Card>

          <Card title="Notes">
            <NotesPanel encounterId={enc.id} notes={generalNotes} canAdd={canEdit} />
          </Card>

          {(!draft || amendments.length > 0) && (
            <Card title="Amendment history" description="Post-signature corrections. The finalized note above is never overwritten.">
              <AmendmentPanel encounterId={enc.id} amendments={amendments} canAmend={enc.status === "FINALIZED" && isAuthor && can(session, "encounters:amend")} />
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card title="Vital signs" actions={draft && can(session, "vitals:create") && <RecordVitalsButton encounterId={enc.id} subtitle={`${p.firstName} ${p.lastName} · ${p.mrn}`} />}>
            {!latest ? <p className="text-[13px] text-muted">No vitals recorded for this visit.</p> : (
              <>
                <p className="text-xs text-subtle mb-2">Latest · {formatDateTime(latest.recordedAt, tz)} · {names[latest.recordedById] || "—"}</p>
                <dl className="grid grid-cols-3 gap-3 text-[13px]">
                  {[["BP", latest.systolic != null || latest.diastolic != null ? `${v(latest.systolic)}/${v(latest.diastolic)}` : "—", "mmHg"], ["Pulse", v(latest.pulse), "/min"], ["Temp", v(latest.temperatureC), "°C"], ["Resp", v(latest.respRate), "/min"], ["SpO₂", v(latest.spo2), "%"], ["Weight", v(latest.weightKg), "kg"]].map(([k, val, unit]) => (
                    <div key={k} className="rounded-lg bg-surface-2 border border-border px-2 py-1.5">
                      <dt className="text-[11px] text-muted">{k}</dt>
                      <dd className="font-semibold tabular">{val}{val !== "—" && <span className="text-[11px] font-normal text-muted ml-0.5">{unit}</span>}</dd>
                    </div>
                  ))}
                </dl>
                {enc.vitals.length > 1 && (
                  <details className="mt-3">
                    <summary className="text-[12.5px] font-semibold text-primary cursor-pointer">History ({enc.vitals.length} sets)</summary>
                    <div className="table-wrap mt-2">
                      <table className="table text-[12px]">
                        <thead><tr><th>Time</th><th>BP</th><th className="num">HR</th><th className="num">T</th><th className="num">SpO₂</th></tr></thead>
                        <tbody>
                          {enc.vitals.map((x) => (
                            <tr key={x.id}><td className="whitespace-nowrap">{formatDateTime(x.recordedAt, tz, { year: undefined })}</td><td className="tabular">{x.systolic != null ? `${x.systolic}/${v(x.diastolic)}` : "—"}</td><td className="num">{v(x.pulse)}</td><td className="num">{v(x.temperatureC)}</td><td className="num">{v(x.spo2)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </>
            )}
          </Card>

          <Card title="Visit">
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between gap-2"><dt className="text-muted">Clinician</dt><dd className="text-right">{doctor}<span className="block text-xs text-muted">{enc.doctor.specialty}</span></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Department</dt><dd>{enc.department.name}</dd></div>
              {enc.appointment ? (
                <>
                  <div className="flex justify-between gap-2"><dt className="text-muted">Appointment</dt><dd>{can(session, "appointments:read") ? <Link href={`/appointments/${enc.appointment.id}`} className="font-mono text-primary hover:underline">{enc.appointment.appointmentNo}</Link> : enc.appointment.appointmentNo}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted">Type</dt><dd>{typeLabel(enc.appointment.type)}</dd></div>
                  {enc.appointment.queueEntry && <div className="flex justify-between gap-2"><dt className="text-muted">Token</dt><dd className="inline-flex items-center gap-1"><Ticket size={13} aria-hidden />#{enc.appointment.queueEntry.tokenNumber} <StatusBadge status={enc.appointment.queueEntry.status} /></dd></div>}
                </>
              ) : <div className="flex justify-between gap-2"><dt className="text-muted">Appointment</dt><dd className="text-muted">Ad-hoc consultation</dd></div>}
              {enc.followUpDate && <div className="flex justify-between gap-2"><dt className="text-muted">Follow-up</dt><dd>{formatDateOnly(enc.followUpDate)}</dd></div>}
            </dl>
          </Card>

          <Card title="Previous visits" actions={<History size={15} className="text-muted" aria-hidden />}>
            {previous.length === 0 ? <p className="text-[13px] text-muted">No earlier finalized consultations.</p> : (
              <ul className="space-y-2.5">
                {previous.map((e) => (
                  <li key={e.id} className="text-[13px]">
                    <Link href={`/consultations/${e.id}`} className="font-mono text-[12px] font-semibold text-primary hover:underline">{e.encounterNo}</Link>
                    <span className="text-xs text-subtle ml-2">{formatDate(e.startedAt, tz)} · Dr. {e.doctor.staff.lastName}</span>
                    {e.diagnoses[0] && <span className="block text-muted truncate">{e.diagnoses[0].description}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {draft && enc.prescriptions.some((r) => r.status === "DRAFT") && <p className="text-[12px] text-muted"><Badge tone="neutral" plain>{draftRx} draft Rx</Badge> will be issued on finalization.</p>}
        </aside>
      </div>
    </>
  );
}
