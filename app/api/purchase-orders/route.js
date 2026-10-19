import { route, ok } from "@/lib/api/handler";
import { poQuery, purchaseOrderSchema } from "@/lib/validation/inventory";
import { listPurchaseOrders, createPurchaseOrder } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "inventory:read" }, async ({ query }) => {
  const q = query(poQuery);
  const h = await getHospital();
  const { rows, meta } = await listPurchaseOrders(q, h.timezone);
  return ok(rows, meta);
});

// Creates a DRAFT purchase order. Body: { supplierId, items: [{ inventoryItemId, quantity, unitCost }] }
export const POST = route({ permission: "inventory:manage" }, async ({ body, session, ip }) => {
  const input = await body(purchaseOrderSchema);
  return ok(await createPurchaseOrder(input, session, ip), undefined, { status: 201 });
});
