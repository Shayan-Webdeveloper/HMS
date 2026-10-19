import { route } from "@/lib/api/handler";
import { startTreatmentSchema } from "@/lib/validation/emergency";
import { startTreatment } from "@/lib/services/emergency";

export const POST = route({ permission: "emergency:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(startTreatmentSchema);
  return startTreatment(params.id, input, session, ip);
});
