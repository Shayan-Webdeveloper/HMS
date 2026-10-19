import { route, ok } from "@/lib/api/handler";
import { appointmentRequestSchema } from "@/lib/validation/portal";
import { portalAppointments, requestPortalAppointment } from "@/lib/services/dashboard";
import { getHospital } from "@/lib/services/settings";

// Patient portal: always scoped to session.patientId — no patient id is ever read from the request.
export const GET = route({ portal: true }, async ({ session }) => portalAppointments(session.patientId));

export const POST = route({ portal: true }, async ({ body, session, ip }) => {
  const input = await body(appointmentRequestSchema);
  const h = await getHospital();
  const appt = await requestPortalAppointment(input, h.settings.appointments, h.timezone, session, ip);
  return ok(appt, undefined, { status: 201 });
});
