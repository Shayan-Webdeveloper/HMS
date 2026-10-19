import { route } from "@/lib/api/handler";
import { can } from "@/lib/auth/session";
import { notFound } from "@/lib/errors";
import { supplierSchema } from "@/lib/validation/inventory";
import { getSupplier, updateSupplier } from "@/lib/services/inventory";

// Purchase history and "total received value". No payment model exists, so no balances are reported.
export const GET = route({ permission: "inventory:read" }, async ({ params, session }) => {
  const s = await getSupplier(params.id, { includePharmacy: can(session, "pharmacy:read") });
  if (!s) throw notFound();
  return s;
});

export const PATCH = route({ permission: "inventory:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(supplierSchema);
  return updateSupplier(params.id, input, session, ip);
});
