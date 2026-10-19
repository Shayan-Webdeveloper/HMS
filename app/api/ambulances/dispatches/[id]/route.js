import { route } from "@/lib/api/handler";
import { dispatchStatusSchema } from "@/lib/validation/emergency";
import { progressDispatch } from "@/lib/services/ambulances";

// Progress a dispatch: ON_SCENE → TRANSPORTING → COMPLETED, or CANCELLED.
export const POST = route({ permission: "ambulance:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(dispatchStatusSchema);
  return progressDispatch(params.id, input, session, ip);
});
