import { route } from "@/lib/api/handler";
import { completeAppointment } from "@/lib/services/appointments";

export const POST = route({ permission: "appointments:update" }, async ({ params, session, ip }) => completeAppointment(params.id, session, ip));
