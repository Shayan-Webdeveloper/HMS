import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getAdmission, userNames } from "@/lib/services/admissions";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { formatLos, doctorName, titleCase } from "@/lib/validation/inpatient";
import { ageFromDob, formatDateTime, formatDate, formatDateOnly } from "@/lib/utils/time";
import { formatMoney } from "@/lib/utils/money";
import { PrintLayout, PrintField } from "@/components/inpatient/PrintLayout";

export const metadata = { title: "Admission summary" };

export default async function AdmissionPrintPage({ params }) {
  const session = await requirePageSession("admissions:read");
  const { id } = await params;
  const a = await getAdmission(id);
  if (!a) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const names = await userNames([a.createdById]);
  await audit({ userId: session.user.id, action: "admission.print", entityType: "Admission", entityId: a.id });
  const p = a.patient;
  const age = ageFromDob(p.dateOfBirth);
  const ec = p.emergencyContacts[0];
  const current = a.bedAssignments.find((b) => !b.endedAt);

  return (
    <PrintLayout hospital={h} title="Admission summary" docNo={a.admissionNo} backHref={`/admissions/${a.id}`} generatedLabel={`${formatDateTime(new Date(), tz)} by ${session.user.name}`}>
      <section className="mb-6">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted mb-2">Patient</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PrintField label="Name">{p.firstName} {p.lastName}</PrintField>
          <PrintField label="MRN"><span className="font-mono">{p.mrn}</span></PrintField>
          <PrintField label="Age / sex">{age != null ? `${age} y` : "—"} / {p.sex.toLowerCase()}</PrintField>
          <PrintField label="Date of birth">{p.dateOfBirth ? formatDateOnly(p.dateOfBirth) : "—"}</PrintField>
          <PrintField label="Phone">{p.phone}</PrintField>
          <PrintField label="Blood group">{p.bloodGroup}</PrintField>
          <PrintField label="Address" wide>{[p.address, p.city].filter(Boolean).join(", ")}</PrintField>
          <PrintField label="Emergency contact" wide>{ec ? `${ec.name}${ec.relationship ? ` (${ec.relationship})` : ""} — ${ec.phone}` : null}</PrintField>
          <PrintField label="Allergies" wide>{p.allergies.length ? p.allergies.map((x) => `${x.substance}${x.reaction ? ` (${x.reaction})` : ""} — ${x.severity.toLowerCase()}`).join("; ") : "No known allergies recorded"}</PrintField>
        </dl>
      </section>
      <section className="mb-6">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted mb-2">Admission</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <PrintField label="Admission no."><span className="font-mono">{a.admissionNo}</span></PrintField>
          <PrintField label="Status">{titleCase(a.status)}</PrintField>
          <PrintField label="Admitted">{formatDateTime(a.admittedAt, tz)}</PrintField>
          <PrintField label={a.dischargedAt ? "Discharged" : "Expected discharge"}>{a.dischargedAt ? formatDateTime(a.dischargedAt, tz) : a.expectedDischargeAt ? formatDate(a.expectedDischargeAt, tz) : null}</PrintField>
          <PrintField label="Admitting doctor">{doctorName(a.doctor)}</PrintField>
          <PrintField label="Department">{a.doctor.department?.name}</PrintField>
          <PrintField label="Current bed">{current ? `${current.bed.ward.name} · ${current.bed.label}` : null}</PrintField>
          <PrintField label="Length of stay">{formatLos(a.admittedAt, a.dischargedAt, tz)}</PrintField>
          <PrintField label="Admitted by">{names[a.createdById]}</PrintField>
          <PrintField label="Reason for admission" wide>{a.reason}</PrintField>
        </dl>
      </section>
      <section>
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-muted mb-2">Bed history</h2>
        <table className="table !text-[12.5px]">
          <thead><tr><th>Ward</th><th>Bed</th><th>From</th><th>To</th><th className="num">Daily rate</th></tr></thead>
          <tbody>
            {a.bedAssignments.map((b) => (
              <tr key={b.id}><td>{b.bed.ward.name}</td><td className="font-mono">{b.bed.label}</td><td>{formatDateTime(b.startedAt, tz)}</td><td>{b.endedAt ? formatDateTime(b.endedAt, tz) : "Current"}</td><td className="num">{formatMoney(b.bed.ward.dailyRate, h.currency, h.locale)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </PrintLayout>
  );
}
