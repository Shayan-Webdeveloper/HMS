import { route } from "@/lib/api/handler";
import { activeToggleSchema } from "@/lib/validation/pharmacy";
import { setMedicationActive } from "@/lib/services/pharmacy";

export const POST = route({ permission: "pharmacy:manage" }, async ({ params, body, session, ip }) => {
  const { isActive, reason } = await body(activeToggleSchema);
  return setMedicationActive(params.id, isActive, reason, session, ip);
});
