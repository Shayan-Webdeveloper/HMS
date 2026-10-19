import { route } from "@/lib/api/handler";
import { markNoShow } from "@/lib/services/appointments";

export const POST = route({ permission: "appointments:update" }, async ({ params, session, ip }) => markNoShow(params.id, session, ip));
