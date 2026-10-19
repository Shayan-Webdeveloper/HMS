import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getStaff, listPositions } from "@/lib/services/staff";
import { listDepartmentOptions } from "@/lib/services/departments";
import { getHospital } from "@/lib/services/settings";
import { serialize } from "@/lib/utils/serialize";
import { todayInTz } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StaffForm } from "@/components/staff/StaffForm";

export const metadata = { title: "Edit staff member" };

export default async function EditStaffPage({ params }) {
  await requirePageSession("staff:manage");
  const { id } = await params;
  const [s, departments, positions, h] = await Promise.all([getStaff(id), listDepartmentOptions({ includeInactive: true }), listPositions(), getHospital()]);
  if (!s) notFound();
  const staff = serialize({
    id: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone, departmentId: s.departmentId, position: s.position,
    joiningDate: s.joiningDate, shift: s.shift, emergencyContactName: s.emergencyContactName, emergencyContactPhone: s.emergencyContactPhone,
    employmentStatus: s.employmentStatus, doctorProfile: s.doctorProfile ? { id: s.doctorProfile.id } : null,
  });
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit ${s.firstName} ${s.lastName}`} description={`${s.employeeNo}${s.doctorProfile ? " · clinical details are edited on the doctor profile" : ""}`} />
      <Card><StaffForm staff={staff} departments={departments} today={todayInTz(h.timezone)} positions={positions} /></Card>
    </div>
  );
}
