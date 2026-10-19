import { requirePageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listTheatres } from "@/lib/services/procedures";
import { getHospital } from "@/lib/services/settings";
import { todayInTz, addDays } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { ProcedureForm } from "@/components/procedures/ProcedureForm";

export const metadata = { title: "Schedule procedure" };

export default async function NewProcedurePage({ searchParams }) {
  const session = await requirePageSession("procedures:manage");
  const sp = await searchParams;
  const h = await getHospital();
  const pid = typeof sp.patientId === "string" ? sp.patientId : null;
  const [theatres, patient, doctor] = await Promise.all([
    listTheatres({ includeInactive: false }),
    pid ? prisma.patient.findFirst({ where: { id: pid, status: "ACTIVE" }, select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } }) : null,
    session.doctorId ? prisma.doctorProfile.findUnique({ where: { id: session.doctorId }, select: { id: true, specialty: true, staff: { select: { firstName: true, lastName: true } }, department: { select: { name: true } } } }) : null,
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Schedule procedure" description="A procedure number is assigned automatically. Theatre and surgeon clashes are checked when you save." />
      {theatres.length === 0 ? (
        <div className="card"><EmptyState title="No active theatres" description="Add or activate a theatre before scheduling." action={<Button href="/procedures?tab=theatres">Manage theatres</Button>} /></div>
      ) : (
        <Card>
          <ProcedureForm theatres={theatres} currency={h.currency}
            defaultDate={typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : addDays(todayInTz(h.timezone), 1)}
            initialPatient={patient ? { id: patient.id, label: `${patient.firstName} ${patient.lastName}`, sub: [patient.mrn, patient.phone].filter(Boolean).join(" · ") } : null}
            initialSurgeon={doctor ? { id: doctor.id, label: `Dr. ${doctor.staff.firstName} ${doctor.staff.lastName}`, sub: [doctor.specialty, doctor.department?.name].filter(Boolean).join(" · ") } : null} />
        </Card>
      )}
    </div>
  );
}
