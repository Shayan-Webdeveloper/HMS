import { route } from "@/lib/api/handler";
import { confirmAppointment } from "@/lib/services/appointments";

export const POST = route({ permission: "appointments:update" }, async ({ params, session, ip }) => confirmAppointment(params.id, session, ip));
