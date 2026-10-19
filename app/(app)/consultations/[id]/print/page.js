import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getEncounter, userNames } from "@/lib/services/encounters";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { SOAP_FIELDS, SOAP_LABELS } from "@/lib/validation/encounters";
import { ageFromDob, formatDateOnly, formatDateTime } from "@/lib/utils/time";
import { PrintDocument, PrintSection } from "@/components/clinical/PrintDocument";

export const metadata = { title: "Visit summary" };

const v = (x) => (x == null ? "—" : x.toString());

export default async function VisitSummaryPrintPage({ params }) {
  const session = await requirePageSession("clinical:read");
  const { id } = await params;
  const enc = await getEncounter(id);
  if (!enc) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  await audit({ userId: session.user.id, action: "encounter.print", entityType: "Encounter", entityId: enc.id });
  const names = await userNames([...enc.notes.map((n) => n.authorId), enc.finalizedById]);
  const p = enc.patient;
  const age = ageFromDob(p.dateOfBirth);
  const doctor = `Dr. ${enc.doctor.staff.firstName} ${enc.doctor.staff.lastName}`;
  const latest = enc.vitals[0];
  const rx = enc.prescriptions.filter((r) => r.status !== "CANCELLED");
  const amendments = enc.notes.filter((n) => n.kind === "AMENDMENT");
  const notes = enc.notes.filter((n) => n.kind !== "AMENDMENT");
  const watermark = enc.status === "DRAFT" ? "DRAFT — NOT FINALIZED" : enc.status === "CANCELLED" ? "CANCELLED" : null;

  return (
    <PrintDocument hospital={h} title="Visit summary" documentId={enc.encounterNo} generatedLabel={formatDateTime(new Date(), tz)} backHref={`/consultations/${enc.id}`} backLabel="Back to consultation" watermark={watermark}>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted font-bold">Patient</p>
          <p className="text-[15px] font-semibold">{p.firstName} {p.lastName}</p>
          <p>MRN <span className="font-mono font-semibold">{p.mrn}</span> · {age != null ? `${age} y` : "Age —"} · {p.sex === "UNKNOWN" ? "—" : p.sex.toLowerCase()}{p.dateOfBirth ? ` · DOB ${formatDateOnly(p.dateOfBirth)}` : ""}</p>
          <p><span className="text-muted">Allergies:</span> <span className={p.allergies.length ? "font-semibold text-danger" : ""}>{p.allergies.length ? p.allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ""}`).join("; ") : "None recorded"}</span></p>
          {p.medicalAlerts && <p><span className="text-muted">Alerts:</span> {p.medicalAlerts}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] uppercase tracking-wider text-muted font-bold">Visit</p>
          <p>{formatDateTime(enc.startedAt, tz)} · {enc.type}</p>
          <p>{doctor} · {enc.department.name}</p>
          {enc.appointment && <p>Appointment <span className="font-mono">{enc.appointment.appointmentNo}</span></p>}
        </div>
      </div>

      {latest && (
        <PrintSection title={`Vital signs (${formatDateTime(latest.recordedAt, tz)})`}>
          <p className="tabular">BP {latest.systolic != null ? `${latest.systolic}/${v(latest.diastolic)}` : "—"} mmHg · Pulse {v(latest.pulse)}/min · Temp {v(latest.temperatureC)} °C · Resp {v(latest.respRate)}/min · SpO₂ {v(latest.spo2)}% · Wt {v(latest.weightKg)} kg · Ht {v(latest.heightCm)} cm</p>
        </PrintSection>
      )}

      {SOAP_FIELDS.filter((k) => enc[k]).map((k) => (
        <PrintSection key={k} title={SOAP_LABELS[k]}><p className="whitespace-pre-wrap">{enc[k]}</p></PrintSection>
      ))}

      <PrintSection title="Diagnoses">
        {enc.diagnoses.length === 0 ? <p className="text-muted">None recorded.</p> : (
          <ol className="list-decimal pl-5 space-y-0.5">
            {enc.diagnoses.map((d) => <li key={d.id}>{d.code && <span className="font-mono font-semibold mr-1.5">{d.code}</span>}{d.description}{d.isPrimary && <span className="text-muted"> (primary)</span>}</li>)}
          </ol>
        )}
      </PrintSection>

      {rx.length > 0 && (
        <PrintSection title="Medicines prescribed">
          {rx.map((r) => (
            <div key={r.id} className="mb-2">
              <p className="text-[12px] text-muted"><span className="font-mono">{r.prescriptionNo}</span> · {r.status.replace(/_/g, " ").toLowerCase()}</p>
              <ul className="pl-5 list-disc">
                {r.items.map((it) => <li key={it.id}><span className="font-semibold">{it.medication.genericName} {it.medication.strength}</span>{it.medication.brandName ? ` (${it.medication.brandName})` : ""} — {it.dose}, {it.route}, {it.frequency} × {it.durationDays} days · qty {it.quantity}{it.instructions ? ` · ${it.instructions}` : ""}</li>)}
              </ul>
            </div>
          ))}
        </PrintSection>
      )}

      {(enc.labOrders.length > 0 || enc.imagingStudies.length > 0) && (
        <PrintSection title="Investigations ordered">
          <ul className="pl-5 list-disc">
            {enc.labOrders.map((o) => <li key={o.id}><span className="font-mono">{o.orderNo}</span> — {o.items.map((i) => i.test.name).join(", ")} ({o.priority.toLowerCase()}, {o.status.replace(/_/g, " ").toLowerCase()})</li>)}
            {enc.imagingStudies.map((s) => <li key={s.id}><span className="font-mono">{s.studyNo}</span> — {s.modality} {s.bodyPart} ({s.status.replace(/_/g, " ").toLowerCase()})</li>)}
          </ul>
        </PrintSection>
      )}

      {notes.length > 0 && (
        <PrintSection title="Notes">
          {notes.map((n) => <p key={n.id} className="mb-1.5 whitespace-pre-wrap"><span className="text-muted text-[12px]">{formatDateTime(n.createdAt, tz)} · {names[n.authorId] || "—"}:</span> {n.content}</p>)}
        </PrintSection>
      )}

      <PrintSection title="Follow-up">
        <p>{enc.followUpDate ? formatDateOnly(enc.followUpDate) : "No follow-up date set."}</p>
      </PrintSection>

      {amendments.length > 0 && (
        <PrintSection title="Amendments">
          {amendments.map((n) => (
            <div key={n.id} className="mb-2">
              <p className="text-[12px] text-muted">{formatDateTime(n.createdAt, tz)} · {names[n.authorId] || "—"} · Reason: {n.reason}</p>
              <p className="whitespace-pre-wrap">{n.content}</p>
            </div>
          ))}
        </PrintSection>
      )}

      <div className="mt-8 grid sm:grid-cols-2 gap-6 items-end">
        <div>
          {enc.status === "FINALIZED" ? (
            <p>Electronically signed by <span className="font-semibold">{names[enc.finalizedById] || doctor}</span><br /><span className="text-muted">{formatDateTime(enc.finalizedAt, tz)}</span></p>
          ) : <p className="font-semibold text-danger">Not signed — draft record.</p>}
        </div>
        <div className="sm:text-right">
          <div className="border-t border-ink pt-1 inline-block min-w-[220px] text-center">{doctor}{enc.doctor.licenseNumber ? ` · ${enc.doctor.licenseNumber}` : ""}</div>
        </div>
      </div>
    </PrintDocument>
  );
}
