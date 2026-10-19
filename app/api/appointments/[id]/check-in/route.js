import { route } from "@/lib/api/handler";
import { checkInAppointment } from "@/lib/services/appointments";

export const POST = route({ permission: "appointments:update" }, async ({ params, session, ip }) => checkInAppointment(params.id, session, ip));
