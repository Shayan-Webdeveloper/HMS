import { route } from "@/lib/api/handler";
import { itemAdjustSchema } from "@/lib/validation/inventory";
import { adjustItem } from "@/lib/services/inventory";

// Body: { direction: IN|OUT, quantity, reason }
export const POST = route({ permission: "inventory:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(itemAdjustSchema);
  return adjustItem(params.id, input, session, ip);
});
