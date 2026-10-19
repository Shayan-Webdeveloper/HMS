import { requirePageSession } from "@/lib/auth/session";
import { listDepartmentOptions } from "@/lib/services/departments";
import { listPositions } from "@/lib/services/staff";
import { getHospital } from "@/lib/services/settings";
import { todayInTz } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StaffForm } from "@/components/staff/StaffForm";

export const metadata = { title: "Add staff member" };

export default async function NewStaffPage() {
  await requirePageSession("staff:manage");
  const [h, departments, positions] = await Promise.all([getHospital(), listDepartmentOptions({ includeInactive: false }), listPositions()]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Add staff member" description="For doctors, use “Add doctor” so the clinical profile is created too." />
      <Card><StaffForm departments={departments} today={todayInTz(h.timezone)} positions={positions} /></Card>
    </div>
  );
}
