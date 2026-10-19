import { route } from "@/lib/api/handler";
import { leaveActionSchema } from "@/lib/validation/staff";
import { actOnLeave } from "@/lib/services/hr";
import { getHospital } from "@/lib/services/settings";

// { action: "approve" | "reject" | "cancel", reason? } — approve/reject additionally require hr:manage (checked in the service).
export const POST = route({ permission: ["hr:manage", "staff:manage"] }, async ({ params, body, session, ip }) => {
  const input = await body(leaveActionSchema);
  const h = await getHospital();
  return actOnLeave(params.id, input, h.timezone, session, ip);
});
