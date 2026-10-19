import { route, ok } from "@/lib/api/handler";
import { paymentSchema } from "@/lib/validation/billing";
import { recordPayment } from "@/lib/services/billing";

export const POST = route({ permission: "billing:payment" }, async ({ params, body, session, ip }) => {
  const input = await body(paymentSchema);
  const { payment, duplicate } = await recordPayment(params.id, input, session, ip);
  // Replays of the same idempotency key return the original payment (200) instead of creating another.
  return ok({ ...payment, duplicate }, undefined, { status: duplicate ? 200 : 201 });
});
