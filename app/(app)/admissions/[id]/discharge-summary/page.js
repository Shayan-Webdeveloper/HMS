import { notFound } from "next/navigation";
import { requirePageSession, can } from "@/lib/auth/session";
import { getAdmission, userNames } from "@/lib/services/admissions";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { formatLos, doctorName } from "@/lib/validation/inpatient";
import { ageFromDob, formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { ForbiddenState, EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { PrintLayout, PrintField } from "@/components/inpatient/PrintLayout";

export const metadata = { title: "Discharge summary" };

export default async function DischargeSummaryPage({ params }) {
  const session = await requirePageSession("admissions:read");
  const { id } = await params;
  if (!can(session, "clinical:read")) return <div className="card"><ForbiddenState /></div>;
  const a = await getAdmission(id);
  if (!a) notFound();
  if (a.status !== "DISCHARGED") {
    return (
      <div className="card">
        <EmptyState title="Not discharged yet" description="The discharge summary becomes available once the patient has been discharged."
          action={<Button href={`/admissions/${a.id}`}>Back to admission</Button>} />
      </div>
    );
  }
  const h = await getHospital();
  const tz = h.timezone;
  const names = await userNames([a.createdById]);
  await audit({ userId: session.user.id, action: "admission.print_discharge", entityType: "Admission", entityId: a.id });
  const p = a.patient;
  const age = ageFromDob(p.dateOfBirth, a.dischargedAt);

  return (
    <PrintLayout hospital={h} title="Discharge summary" docNo={a.admissionNo} backHref={`/admissions/${a.id}?tab=discharge`} generatedLabel={`${formatDateTime(new Date(), tz)} by ${session.user.name}`}>
      <section className="mb-6">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted mb-2">Patient</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PrintField label="Name">{p.firstName} {p.lastName}</PrintField>
          <PrintField label="MRN"><span className="font-mono">{p.mrn}</span></PrintField>
          <PrintField label="Age / sex">{age != null ? `${age} y` : "—"} / {p.sex.toLowerCase()}</PrintField>
          <PrintField label="Date of birth">{p.dateOfBirth ? formatDateOnly(p.dateOfBirth) : "—"}</PrintField>
        </dl>
      </section>
      <section className="mb-6">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted mb-2">Admission</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PrintField label="Admission no."><span className="font-mono">{a.admissionNo}</span></PrintField>
          <PrintField label="Admitted">{formatDateTime(a.admittedAt, tz)}</PrintField>
          <PrintField label="Discharged">{formatDateTime(a.dischargedAt, tz)}</PrintField>
          <PrintField label="Length of stay">{formatLos(a.admittedAt, a.dischargedAt, tz)}</PrintField>
          <PrintField label="Consultant">{doctorName(a.doctor)}</PrintField>
          <PrintField label="Department">{a.doctor.department?.name}</PrintField>
          <PrintField label="Admitted by">{names[a.createdById]}</PrintField>
          <PrintField label="Condition at discharge"><span className="font-semibold">{a.dischargeCondition}</span></PrintField>
          <PrintField label="Reason for admission" wide>{a.reason}</PrintField>
          {p.allergies.length > 0 && <PrintField label="Allergies" wide>{p.allergies.map((x) => `${x.substance}${x.reaction ? ` (${x.reaction})` : ""}`).join("; ")}</PrintField>}
        </dl>
      </section>
      <section className="mb-6">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted mb-2">Bed history</h2>
        <table className="table !text-[12.5px]">
          <thead><tr><th>Ward</th><th>Bed</th><th>From</th><th>To</th></tr></thead>
          <tbody>
            {a.bedAssignments.map((b) => (
              <tr key={b.id}><td>{b.bed.ward.name}</td><td className="font-mono">{b.bed.label}</td><td>{formatDateTime(b.startedAt, tz)}</td><td>{formatDateTime(b.endedAt, tz)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted mb-2">Discharge summary</h2>
        <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap border border-border rounded-lg p-4">{a.dischargeSummary}</div>
      </section>
      <section className="mt-12 grid grid-cols-2 gap-10 text-[12px]">
        <div className="border-t border-ink pt-1">Treating clinician — {doctorName(a.doctor)}</div>
        <div className="border-t border-ink pt-1">Patient / attendant signature</div>
      </section>
    </PrintLayout>
  );
}
