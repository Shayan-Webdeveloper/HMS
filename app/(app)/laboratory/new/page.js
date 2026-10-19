import { UserX } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listOrderableTests } from "@/lib/services/lab";
import { getHospital } from "@/lib/services/settings";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { LabOrderForm } from "@/components/laboratory/LabOrderForm";

export const metadata = { title: "New lab order" };

export default async function NewLabOrderPage({ searchParams }) {
  const session = await requirePageSession("lab:order");
  const sp = await searchParams;
  const h = await getHospital();

  if (!session.doctorId) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="New lab order" />
        <div className="card">
          <EmptyState icon={UserX} title="A doctor profile is required"
            description="Laboratory orders are recorded against the ordering doctor. Your account is not linked to a doctor profile; ask an administrator to link one, or ask a doctor to place the order."
            action={<Button href="/laboratory">Back to laboratory</Button>} />
        </div>
      </div>
    );
  }

  // Optional prefill from other modules: /laboratory/new?patientId=…&encounterId=…
  const pid = typeof sp.patientId === "string" ? sp.patientId.slice(0, 64) : null;
  const eid = typeof sp.encounterId === "string" ? sp.encounterId.slice(0, 64) : null;
  const [tests, patient, encounter] = await Promise.all([
    listOrderableTests(),
    pid ? prisma.patient.findFirst({ where: { id: pid, status: "ACTIVE" }, select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } }) : null,
    pid && eid ? prisma.encounter.findFirst({ where: { id: eid, patientId: pid, status: { in: ["DRAFT", "FINALIZED"] } }, select: { id: true, encounterNo: true } }) : null,
  ]);

  return (
    <div className="max-w-6xl">
      <PageHeader title="New lab order" description="Order laboratory tests for a patient. The laboratory is notified immediately." />
      {tests.length === 0 ? (
        <div className="card"><EmptyState title="No active tests" description="The laboratory test catalogue has no active tests. Ask laboratory management to configure the catalogue." /></div>
      ) : (
        <LabOrderForm tests={serialize(tests)} currency={h.currency} initialPatient={patient ? toPickerValue(patient) : null} encounter={encounter} />
      )}
    </div>
  );
}

// Same shape as EntityPicker's mapPatient (which lives in a client module and can't be called here).
function toPickerValue(p) {
  return { id: p.id, label: `${p.firstName} ${p.lastName}`, sub: [p.mrn, p.phone].filter(Boolean).join(" · "), raw: p };
}
