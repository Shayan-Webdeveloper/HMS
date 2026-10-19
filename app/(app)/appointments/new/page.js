import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getHospital } from "@/lib/services/settings";
import { listDoctorOptions, listDepartmentOptions } from "@/lib/services/appointments";
import { todayInTz } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { AppointmentForm } from "@/components/appointments/AppointmentForm";

export const metadata = { title: "Book appointment" };

export default async function NewAppointmentPage({ searchParams }) {
  const session = await requirePageSession("appointments:create");
  const sp = await searchParams;
  const h = await getHospital();
  const [doctors, departments] = await Promise.all([listDoctorOptions(), listDepartmentOptions()]);
  let patient = null;
  if (typeof sp.patientId === "string" && sp.patientId.length <= 64) {
    const p = await prisma.patient.findUnique({ where: { id: sp.patientId }, select: { id: true, mrn: true, firstName: true, lastName: true, phone: true, status: true } });
    if (p && p.status === "ACTIVE") patient = { id: p.id, label: `${p.firstName} ${p.lastName}`, sub: [p.mrn, p.phone].filter(Boolean).join(" · ") };
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date || "") ? sp.date : undefined;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Book appointment" description="Pick a doctor and date to see live availability. Slots are re-checked when you save, so two people can never book the same time." />
      <Card>
        {doctors.length === 0 ? (
          <EmptyState title="No doctors are accepting appointments" description="Doctor profiles and clinic hours are managed under Doctors." />
        ) : (
          <AppointmentForm patient={patient} doctors={doctors} departments={departments} defaults={{ doctorId: typeof sp.doctorId === "string" ? sp.doctorId : undefined, date, type: sp.type }}
            canEditFee={can(session, "billing:discount")} currency={h.currency} today={todayInTz(h.timezone)} />
        )}
      </Card>
    </div>
  );
}
