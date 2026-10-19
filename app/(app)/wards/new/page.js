import { requirePageSession } from "@/lib/auth/session";
import { listDepartmentOptions } from "@/lib/services/wards";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { WardForm } from "@/components/inpatient/WardForm";

export const metadata = { title: "New ward" };

export default async function NewWardPage() {
  await requirePageSession("wards:manage");
  const departments = await listDepartmentOptions();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New ward" description="Create the ward first, then add its beds." />
      <Card><WardForm departments={departments} /></Card>
    </div>
  );
}
