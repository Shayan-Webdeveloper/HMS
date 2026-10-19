import { route } from "@/lib/api/handler";
import { dispenseSchema } from "@/lib/validation/pharmacy";
import { dispensePrescription } from "@/lib/services/pharmacy";

// Body: { items: [{ itemId, quantity }] } — FEFO allocation across non-expired batches, all-or-nothing.
export const POST = route({ permission: "pharmacy:dispense" }, async ({ params, body, session, ip }) => {
  const input = await body(dispenseSchema);
  return dispensePrescription(params.id, input, session, ip);
});
