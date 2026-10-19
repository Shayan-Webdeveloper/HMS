import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getPatientProfile } from "@/lib/services/patients";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { PatientForm } from "@/components/patients/PatientForm";

export const metadata = { title: "Edit patient" };

export default async function EditPatientPage({ params }) {
  await requirePageSession("patients:update");
  const { id } = await params;
  const p = await getPatientProfile(id);
  if (!p || p.status === "MERGED") notFound();
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${p.firstName} ${p.lastName}`} description={`MRN ${p.mrn}`} />
      <Card><PatientForm patient={serialize(p)} /></Card>
    </div>
  );
}
