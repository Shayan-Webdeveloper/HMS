import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { purchaseOrderSchema } from "@/lib/validation/inventory";
import { getPurchaseOrder, updatePurchaseOrder } from "@/lib/services/inventory";

export const GET = route({ permission: "inventory:read" }, async ({ params }) => {
  const po = await getPurchaseOrder(params.id);
  if (!po) throw notFound();
  return po;
});

// Edit allowed only while DRAFT (race-safe conditional update).
export const PATCH = route({ permission: "inventory:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(purchaseOrderSchema);
  return updatePurchaseOrder(params.id, input, session, ip);
});
