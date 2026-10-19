import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { getLabOrder, redactLabOrder } from "@/lib/services/lab";

export const GET = route({ permission: "lab:read" }, async ({ params, session, ip }) => {
  const order = await getLabOrder(params.id);
  if (!order) throw notFound("Lab order not found");
  await audit({ userId: session.user.id, action: "lab.order.view", entityType: "LabOrder", entityId: order.id, ipAddress: ip });
  const { doctor, ...rest } = redactLabOrder(order, session);
  return { ...rest, doctor: { id: doctor.id, name: `${doctor.staff.firstName} ${doctor.staff.lastName}`, specialty: doctor.specialty, departmentName: doctor.department?.name ?? null } };
});
