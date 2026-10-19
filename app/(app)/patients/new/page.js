import { requirePageSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { PatientForm } from "@/components/patients/PatientForm";

export const metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  await requirePageSession("patients:create");
  return (
    <div className="max-w-4xl">
      <PageHeader title="Register patient" description="A unique MRN is assigned automatically. Possible duplicates are flagged before saving." />
      <Card><PatientForm /></Card>
    </div>
  );
}
