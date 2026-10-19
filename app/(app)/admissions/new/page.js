import { requirePageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listWardOptions } from "@/lib/services/wards";
import { getOpenAdmissionForPatient } from "@/lib/services/admissions";
import { getHospital } from "@/lib/services/settings";
import { formatMoney } from "@/lib/utils/money";
import { todayInTz } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { AdmissionForm } from "@/components/inpatient/AdmissionForm";

export const metadata = { title: "Admit patient" };

export default async function NewAdmissionPage({ searchParams }) {
  const session = await requirePageSession("admissions:create");
  const sp = await searchParams;
  const h = await getHospital();
  const pid = typeof sp.patientId === "string" ? sp.patientId : null;
  const [patient, wards, doctor] = await Promise.all([
    pid ? prisma.patient.findFirst({ where: { id: pid, status: "ACTIVE" }, select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } }) : null,
    listWardOptions(),
    session.doctorId ? prisma.doctorProfile.findUnique({ where: { id: session.doctorId }, select: { id: true, specialty: true, staff: { select: { firstName: true, lastName: true } }, department: { select: { name: true } } } }) : null,
  ]);
  const open = patient ? await getOpenAdmissionForPatient(patient.id) : null;
  const wardOptions = serialize(wards.map((w) => ({ ...w, dailyRateLabel: formatMoney(w.dailyRate, h.currency, h.locale) })));
  const wardId = typeof sp.wardId === "string" && wards.some((w) => w.id === sp.wardId) ? sp.wardId : "";
  const bedId = wardId && typeof sp.bedId === "string" ? sp.bedId : "";

  return (
    <div className="max-w-4xl">
      <PageHeader title="Admit patient" description="Assign an available bed. An admission number is generated and nursing staff are notified." />
      <Card>
        <AdmissionForm
          initialPatient={patient ? { id: patient.id, label: `${patient.firstName} ${patient.lastName}`, sub: [patient.mrn, patient.phone].filter(Boolean).join(" · ") } : null}
          initialDoctor={doctor ? { id: doctor.id, label: `Dr. ${doctor.staff.firstName} ${doctor.staff.lastName}`, sub: [doctor.specialty, doctor.department?.name].filter(Boolean).join(" · ") } : null}
          wards={wardOptions} initialWardId={wardId} initialBedId={bedId}
          openAdmission={open} today={todayInTz(h.timezone)} />
      </Card>
    </div>
  );
}
