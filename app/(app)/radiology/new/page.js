import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getImagingCatalog } from "@/lib/services/radiology";
import { getHospital } from "@/lib/services/settings";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { ImagingRequestForm } from "@/components/radiology/ImagingRequestForm";

export const metadata = { title: "New imaging request" };

export default async function NewImagingRequestPage({ searchParams }) {
  const session = await requirePageSession("radiology:order");
  const sp = await searchParams;
  const h = await getHospital();
  // Optional prefill from other modules: /radiology/new?patientId=…&encounterId=…
  const pid = typeof sp.patientId === "string" ? sp.patientId.slice(0, 64) : null;
  const eid = typeof sp.encounterId === "string" ? sp.encounterId.slice(0, 64) : null;
  const [catalog, patient, encounter] = await Promise.all([
    getImagingCatalog(),
    pid ? prisma.patient.findFirst({ where: { id: pid, status: "ACTIVE" }, select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } }) : null,
    pid && eid ? prisma.encounter.findFirst({ where: { id: eid, patientId: pid, status: { in: ["DRAFT", "FINALIZED"] } }, select: { id: true, encounterNo: true } }) : null,
  ]);
  return (
    <div className="max-w-5xl">
      <Link href="/radiology" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ChevronLeft size={15} aria-hidden /> Radiology worklist</Link>
      <PageHeader title="New imaging request" description="Request an imaging examination. Radiology is notified to schedule it." />
      {catalog.length === 0 ? (
        <div className="card"><EmptyState title="The imaging catalogue is empty" description="Radiology needs to configure examinations before requests can be made."
          action={can(session, ["radiology:verify", "settings:manage"]) && <Button href="/radiology/catalog">Configure catalogue</Button>} /></div>
      ) : (
        <ImagingRequestForm catalog={catalog} currency={h.currency} encounter={encounter}
          initialPatient={patient ? { id: patient.id, label: `${patient.firstName} ${patient.lastName}`, sub: [patient.mrn, patient.phone].filter(Boolean).join(" · "), raw: patient } : null} />
      )}
    </div>
  );
}
