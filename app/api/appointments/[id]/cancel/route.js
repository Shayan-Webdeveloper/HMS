import { route } from "@/lib/api/handler";
import { cancelSchema } from "@/lib/validation/appointments";
import { cancelAppointment } from "@/lib/services/appointments";

export const POST = route({ permission: "appointments:cancel" }, async ({ params, body, session, ip }) => {
  const { reason } = await body(cancelSchema);
  return cancelAppointment(params.id, reason, session, ip);
});
