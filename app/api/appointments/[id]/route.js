import { route } from "@/lib/api/handler";
import { appointmentUpdateSchema } from "@/lib/validation/appointments";
import { getAppointment, updateAppointment } from "@/lib/services/appointments";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "appointments:read" }, async ({ params }) => {
  const a = await getAppointment(params.id);
  if (!a) throw notFound();
  return a;
});

export const PATCH = route({ permission: "appointments:update" }, async ({ params, body, session, ip }) => {
  const input = await body(appointmentUpdateSchema);
  return updateAppointment(params.id, input, session, ip);
});
