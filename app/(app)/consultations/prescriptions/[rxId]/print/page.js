import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { ageFromDob, formatDateOnly, formatDateTime } from "@/lib/utils/time";
import { PrintDocument, PrintSection } from "@/components/clinical/PrintDocument";

export const metadata = { title: "Prescription" };

export default async function PrescriptionPrintPage({ params }) {
  const session = await requirePageSession(["prescriptions:read", "clinical:read"]);
  const { rxId } = await params;
  const rx = await prisma.prescription.findUnique({
    where: { id: rxId },
    include: {
      items: { include: { medication: { select: { genericName: true, brandName: true, strength: true, dosageForm: true } } } },
      patient: { select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true, allergies: { where: { isActive: true }, select: { substance: true, reaction: true } } } },
      doctor: { select: { specialty: true, qualifications: true, licenseNumber: true, staff: { select: { firstName: true, lastName: true } } } },
      encounter: { select: { id: true, encounterNo: true } },
    },
  });
  if (!rx) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  await audit({ userId: session.user.id, action: "prescription.print", entityType: "Prescription", entityId: rx.id });
  const p = rx.patient;
  const age = ageFromDob(p.dateOfBirth);
  const doctor = `Dr. ${rx.doctor.staff.firstName} ${rx.doctor.staff.lastName}`;
  const watermark = rx.status === "DRAFT" ? "DRAFT — NOT VALID FOR DISPENSING" : rx.status === "CANCELLED" ? "CANCELLED" : null;
  const backHref = rx.encounter ? `/consultations/${rx.encounter.id}` : `/patients/${p.id}?tab=prescriptions`;

  return (
    <PrintDocument hospital={h} title="Prescription" documentId={rx.prescriptionNo} generatedLabel={formatDateTime(new Date(), tz)} backHref={backHref} backLabel="Back" watermark={watermark}>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted font-bold">Patient</p>
          <p className="text-[15px] font-semibold">{p.firstName} {p.lastName}</p>
          <p>MRN <span className="font-mono font-semibold">{p.mrn}</span> · {age != null ? `${age} y` : "Age —"} · {p.sex === "UNKNOWN" ? "—" : p.sex.toLowerCase()}{p.dateOfBirth ? ` · DOB ${formatDateOnly(p.dateOfBirth)}` : ""}</p>
          <p><span className="text-muted">Allergies:</span> <span className={p.allergies.length ? "font-semibold text-danger" : ""}>{p.allergies.length ? p.allergies.map((a) => a.substance).join("; ") : "None recorded"}</span></p>
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] uppercase tracking-wider text-muted font-bold">Prescriber</p>
          <p className="font-semibold">{doctor}</p>
          <p>{[rx.doctor.qualifications, rx.doctor.specialty].filter(Boolean).join(" · ")}</p>
          <p>Licence {rx.doctor.licenseNumber}</p>
          <p className="mt-1">{rx.issuedAt ? <>Issued {formatDateTime(rx.issuedAt, tz)}</> : <>Created {formatDateTime(rx.createdAt, tz)}</>}</p>
          {rx.encounter && <p className="text-muted">Visit <span className="font-mono">{rx.encounter.encounterNo}</span></p>}
        </div>
      </div>

      <PrintSection title="℞ Medicines">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-1.5 pr-2 font-semibold">#</th><th className="py-1.5 pr-2 font-semibold">Medicine</th><th className="py-1.5 pr-2 font-semibold">Dose / route</th><th className="py-1.5 pr-2 font-semibold">Frequency</th><th className="py-1.5 pr-2 font-semibold text-right">Days</th><th className="py-1.5 font-semibold text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {rx.items.map((it, i) => (
              <tr key={it.id} className="border-b border-border align-top">
                <td className="py-2 pr-2 tabular">{i + 1}</td>
                <td className="py-2 pr-2"><span className="font-semibold">{it.medication.genericName} {it.medication.strength}</span>{it.medication.brandName ? ` (${it.medication.brandName})` : ""}<span className="block text-muted">{it.medication.dosageForm.toLowerCase()}{it.instructions ? ` · ${it.instructions}` : ""}</span></td>
                <td className="py-2 pr-2">{it.dose}, {it.route}</td>
                <td className="py-2 pr-2">{it.frequency}</td>
                <td className="py-2 pr-2 text-right tabular">{it.durationDays}</td>
                <td className="py-2 text-right tabular">{it.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PrintSection>

      {rx.notes && <PrintSection title="Notes"><p className="whitespace-pre-wrap">{rx.notes}</p></PrintSection>}
      {rx.status === "CANCELLED" && rx.cancelReason && <PrintSection title="Cancellation"><p>{rx.cancelReason}</p></PrintSection>}

      <div className="mt-10 flex justify-end">
        <div className="border-t border-ink pt-1 min-w-[240px] text-center">{doctor}<span className="block text-[11px] text-muted">Signature</span></div>
      </div>
    </PrintDocument>
  );
}
