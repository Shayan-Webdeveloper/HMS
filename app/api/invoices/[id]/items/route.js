import { route, ok } from "@/lib/api/handler";
import { addItemsSchema } from "@/lib/validation/billing";
import { addInvoiceItems } from "@/lib/services/billing";

export const POST = route({ permission: "billing:create" }, async ({ params, body, session, ip }) => {
  const input = await body(addItemsSchema);
  return ok(await addInvoiceItems(params.id, input, session, ip), undefined, { status: 201 });
});
