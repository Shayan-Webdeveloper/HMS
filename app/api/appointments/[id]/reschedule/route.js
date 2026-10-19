import { route } from "@/lib/api/handler";
import { rescheduleSchema } from "@/lib/validation/appointments";
import { rescheduleAppointment } from "@/lib/services/appointments";

export const POST = route({ permission: "appointments:update" }, async ({ params, body, session, ip }) => {
  const input = await body(rescheduleSchema);
  return rescheduleAppointment(params.id, input, session, ip);
});
