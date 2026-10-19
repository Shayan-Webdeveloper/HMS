import { route, ok } from "@/lib/api/handler";
import { invoiceListQuery, createInvoiceSchema } from "@/lib/validation/billing";
import { listInvoices, createInvoice } from "@/lib/services/billing";
import { getHospital } from "@/lib/services/settings";

// Insurance staff search issued invoices when raising claims, so insurance:read may list too.
export const GET = route({ permission: ["billing:read", "insurance:read"] }, async ({ query }) => {
  const q = query(invoiceListQuery);
  const h = await getHospital();
  const { rows, meta } = await listInvoices(q, h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "billing:create" }, async ({ body, session, ip }) => {
  const input = await body(createInvoiceSchema);
  const inv = await createInvoice(input, session, ip);
  return ok(inv, undefined, { status: 201 });
});
