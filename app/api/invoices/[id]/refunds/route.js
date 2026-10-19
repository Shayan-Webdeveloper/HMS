import { route, ok } from "@/lib/api/handler";
import { refundSchema } from "@/lib/validation/billing";
import { recordRefund } from "@/lib/services/billing";

export const POST = route({ permission: "billing:refund" }, async ({ params, body, session, ip }) => {
  const input = await body(refundSchema);
  return ok(await recordRefund(params.id, input, session, ip), undefined, { status: 201 });
});
