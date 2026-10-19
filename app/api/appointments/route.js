import { route, ok } from "@/lib/api/handler";
import { appointmentListQuery, appointmentCreateSchema } from "@/lib/validation/appointments";
import { listAppointments, createAppointment } from "@/lib/services/appointments";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "appointments:read" }, async ({ query }) => {
  const q = query(appointmentListQuery);
  const h = await getHospital();
  const { rows, meta } = await listAppointments(q, h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "appointments:create" }, async ({ body, session, ip }) => {
  const input = await body(appointmentCreateSchema);
  const appt = await createAppointment(input, session, ip);
  return ok(appt, undefined, { status: 201 });
});
