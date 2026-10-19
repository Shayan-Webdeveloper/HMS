import { route } from "@/lib/api/handler";
import { removeScheduleException } from "@/lib/services/staff";

export const DELETE = route({ permission: "staff:manage" }, async ({ params, session, ip }) => {
  return removeScheduleException(params.id, params.exceptionId, session, ip);
});
