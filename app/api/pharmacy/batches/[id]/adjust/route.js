import { route } from "@/lib/api/handler";
import { batchAdjustSchema } from "@/lib/validation/pharmacy";
import { adjustBatch } from "@/lib/services/pharmacy";

export const POST = route({ permission: "pharmacy:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(batchAdjustSchema);
  return adjustBatch(params.id, input, session, ip);
});
