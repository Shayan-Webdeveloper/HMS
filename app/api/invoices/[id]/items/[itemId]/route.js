import { route } from "@/lib/api/handler";
import { lineUpdateSchema } from "@/lib/validation/billing";
import { updateInvoiceLine, removeInvoiceItem } from "@/lib/services/billing";

// Discount changes additionally require billing:discount (checked in the service).
export const PATCH = route({ permission: ["billing:create", "billing:discount"] }, async ({ params, body, session, ip }) => {
  const input = await body(lineUpdateSchema);
  return updateInvoiceLine(params.id, params.itemId, input, session, ip);
});

// Draft invoices only: removing a line from an unissued draft is not a financial record change.
export const DELETE = route({ permission: "billing:create" }, async ({ params, session, ip }) => {
  return removeInvoiceItem(params.id, params.itemId, session, ip);
});
