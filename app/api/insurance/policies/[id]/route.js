import { route } from "@/lib/api/handler";
import { policySchema } from "@/lib/validation/insurance";
import { updatePolicy } from "@/lib/services/insurance";

export const PATCH = route({ permission: "insurance:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(policySchema);
  return updatePolicy(params.id, input, session, ip);
});
