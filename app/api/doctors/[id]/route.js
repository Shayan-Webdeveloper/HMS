import { route } from "@/lib/api/handler";
import { doctorSchema } from "@/lib/validation/staff";
import { getDoctor, updateDoctor, isHrPrivileged } from "@/lib/services/staff";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "staff:read" }, async ({ params, session }) => {
  const d = await getDoctor(params.id);
  if (!d) throw notFound();
  const privileged = isHrPrivileged(session);
  const { staff, ...doc } = d;
  return {
    ...doc,
    name: `${staff.firstName} ${staff.lastName}`,
    staff: {
      id: staff.id, employeeNo: staff.employeeNo, firstName: staff.firstName, lastName: staff.lastName, email: staff.email, phone: staff.phone, position: staff.position,
      ...(privileged ? { joiningDate: staff.joiningDate, employmentStatus: staff.employmentStatus, shift: staff.shift, hasAccount: !!staff.userId } : {}),
    },
  };
});

export const PATCH = route({ permission: "staff:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(doctorSchema);
  return updateDoctor(params.id, input, session, ip);
});
