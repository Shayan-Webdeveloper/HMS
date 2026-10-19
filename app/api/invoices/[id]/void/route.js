import { route } from "@/lib/api/handler";
import { voidSchema } from "@/lib/validation/billing";
import { voidInvoice } from "@/lib/services/billing";

export const POST = route({ permission: "billing:void" }, async ({ params, body, session, ip }) => {
  const { reason } = await body(voidSchema);
  return voidInvoice(params.id, reason, session, ip);
});
