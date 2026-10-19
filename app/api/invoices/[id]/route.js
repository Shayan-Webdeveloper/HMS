import { route } from "@/lib/api/handler";
import { getInvoiceDetail } from "@/lib/services/billing";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "billing:read" }, async ({ params }) => {
  const inv = await getInvoiceDetail(params.id);
  if (!inv) throw notFound("Invoice not found");
  return inv;
});
