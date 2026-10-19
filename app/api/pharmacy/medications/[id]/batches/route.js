import { route, ok } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { receiveBatchSchema } from "@/lib/validation/pharmacy";
import { getMedication, receiveBatch, pharmacyContext } from "@/lib/services/pharmacy";

// Batches of one medication in FEFO order, each classified OK / EXPIRING / EXPIRED.
export const GET = route({ permission: "pharmacy:read" }, async ({ params }) => {
  const m = await getMedication(params.id, await pharmacyContext());
  if (!m) throw notFound();
  return m.batches;
});

// Receive stock: creates a new batch and a RECEIPT ledger row.
export const POST = route({ permission: "pharmacy:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(receiveBatchSchema);
  const b = await receiveBatch(params.id, input, session, ip);
  return ok(b, undefined, { status: 201 });
});
