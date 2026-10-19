import { route } from "@/lib/api/handler";
import { poStatusSchema } from "@/lib/validation/inventory";
import { transitionPurchaseOrder } from "@/lib/services/inventory";

// Body: { status: ORDERED | RECEIVED | CANCELLED, reason? (required for CANCELLED) }
export const POST = route({ permission: "inventory:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(poStatusSchema);
  return transitionPurchaseOrder(params.id, input, session, ip);
});
