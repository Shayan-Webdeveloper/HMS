import { route } from "@/lib/api/handler";
import { claimStatusSchema } from "@/lib/validation/insurance";
import { updateClaimStatus } from "@/lib/services/insurance";

export const POST = route({ permission: "insurance:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(claimStatusSchema);
  return updateClaimStatus(params.id, input, session, ip);
});
