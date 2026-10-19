import { requirePageSession, can } from "@/lib/auth/session";
import { listDepartmentOptions } from "@/lib/services/departments";
import { getHospital } from "@/lib/services/settings";
import { todayInTz } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { DoctorForm } from "@/components/staff/DoctorForm";

export const metadata = { title: "Add doctor" };

export default async function NewDoctorPage() {
  const session = await requirePageSession("staff:manage");
  const [h, departments] = await Promise.all([getHospital(), listDepartmentOptions({ includeInactive: false })]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Add doctor" description="Creates the staff record and clinical profile together. An employee number is assigned automatically." />
      <Card><DoctorForm departments={departments} canCreateAccount={can(session, "users:manage")} today={todayInTz(h.timezone)} currency={h.currency} /></Card>
    </div>
  );
}
