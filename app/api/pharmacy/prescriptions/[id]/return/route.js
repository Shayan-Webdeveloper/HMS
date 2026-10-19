import { route } from "@/lib/api/handler";
import { returnSchema } from "@/lib/validation/pharmacy";
import { returnPrescriptionItem } from "@/lib/services/pharmacy";

// Body: { itemId, batchId, quantity, reason } — returns dispensed stock to a specific batch.
export const POST = route({ permission: "pharmacy:dispense" }, async ({ params, body, session, ip }) => {
  const input = await body(returnSchema);
  return returnPrescriptionItem(params.id, input, session, ip);
});
