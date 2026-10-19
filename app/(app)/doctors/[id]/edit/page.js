import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getDoctor } from "@/lib/services/staff";
import { listDepartmentOptions } from "@/lib/services/departments";
import { getHospital } from "@/lib/services/settings";
import { serialize } from "@/lib/utils/serialize";
import { todayInTz } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { DoctorForm } from "@/components/staff/DoctorForm";

export const metadata = { title: "Edit doctor" };

export default async function EditDoctorPage({ params }) {
  await requirePageSession("staff:manage");
  const { id } = await params;
  const [d, departments, h] = await Promise.all([getDoctor(id), listDepartmentOptions({ includeInactive: true }), getHospital()]);
  if (!d) notFound();
  const doctor = serialize({
    id: d.id, departmentId: d.departmentId, specialty: d.specialty, qualifications: d.qualifications, licenseNumber: d.licenseNumber,
    consultationFee: d.consultationFee.toFixed(2), slotMinutes: d.slotMinutes, acceptsAppointments: d.acceptsAppointments,
    staff: { firstName: d.staff.firstName, lastName: d.staff.lastName, email: d.staff.email, phone: d.staff.phone, position: d.staff.position, joiningDate: d.staff.joiningDate, shift: d.staff.shift },
  });
  return (
    <div className="max-w-4xl">
      <PageHeader title={`Edit Dr. ${d.staff.firstName} ${d.staff.lastName}`} description={`${d.staff.employeeNo} · ${d.specialty}`} />
      <Card><DoctorForm doctor={doctor} departments={departments} today={todayInTz(h.timezone)} currency={h.currency} /></Card>
    </div>
  );
}
