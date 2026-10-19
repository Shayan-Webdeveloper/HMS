import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getProcedure, listTheatres } from "@/lib/services/procedures";
import { getHospital } from "@/lib/services/settings";
import { toZonedDateString, toZonedTimeString } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { ProcedureForm } from "@/components/procedures/ProcedureForm";

export const metadata = { title: "Edit procedure" };

export default async function EditProcedurePage({ params }) {
  await requirePageSession("procedures:manage");
  const { id } = await params;
  const p = await getProcedure(id);
  if (!p) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  if (p.status !== "SCHEDULED") {
    return <div className="card"><EmptyState title="This procedure can no longer be edited" description="Only scheduled procedures can be rescheduled." action={<Button href={`/procedures/${p.id}`}>Back to procedure</Button>} /></div>;
  }
  const theatres = (await listTheatres()).filter((t) => t.isActive || t.id === p.theatreId);
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${p.procedureNo}`} description="Changing the time, theatre, surgeon or procedure resets the pre-procedure checklist." />
      <Card>
        <ProcedureForm theatres={theatres} currency={h.currency}
          procedure={{ id: p.id, theatreId: p.theatreId, name: p.name, date: toZonedDateString(p.scheduledStart, tz), startTime: toZonedTimeString(p.scheduledStart, tz), endTime: toZonedTimeString(p.scheduledEnd, tz), charge: p.charge.toFixed(2), notes: p.notes ?? "" }}
          initialPatient={{ id: p.patient.id, label: `${p.patient.firstName} ${p.patient.lastName}`, sub: p.patient.mrn }}
          initialSurgeon={{ id: p.surgeon.id, label: p.surgeon.name, sub: p.surgeon.specialty }} />
      </Card>
    </div>
  );
}
