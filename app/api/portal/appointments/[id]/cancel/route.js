import { route } from "@/lib/api/handler";
import { portalCancelSchema } from "@/lib/validation/portal";
import { cancelPortalAppointment } from "@/lib/services/dashboard";
import { getHospital } from "@/lib/services/settings";

// Ownership is enforced in the WHERE clause (id + session.patientId); someone else's id returns 404.
export const POST = route({ portal: true }, async ({ params, body, session, ip }) => {
  const { reason } = await body(portalCancelSchema);
  const h = await getHospital();
  return cancelPortalAppointment(params.id, reason, h.settings.appointments, session, ip);
});
