import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { can } from "@/lib/auth/session";
import { forbidden } from "@/lib/errors";
import { listQuery } from "@/lib/validation/common";
import { supplierSchema } from "@/lib/validation/inventory";
import { listSuppliers, lookupSuppliers, createSupplier } from "@/lib/services/inventory";

const lookupQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
  includeInactive: z.preprocess((v) => v === "1" || v === "true", z.boolean()).optional().default(false),
});

// ?lookup=1 → [{ id, name, phone, email, isActive }] for pickers (pharmacy receiving uses this too).
// Otherwise the paginated list with PO counts and received-value totals (inventory:read).
export const GET = route({ permission: ["inventory:read", "pharmacy:read"] }, async ({ query, session, req }) => {
  if (new URL(req.url).searchParams.get("lookup") === "1") return lookupSuppliers(query(lookupQuery));
  if (!can(session, "inventory:read")) throw forbidden();
  const q = query(listQuery.extend({ dir: z.enum(["asc", "desc"]).optional().default("asc") }));
  const { rows, meta } = await listSuppliers(q);
  return ok(rows, meta);
});

export const POST = route({ permission: "inventory:manage" }, async ({ body, session, ip }) => {
  const input = await body(supplierSchema);
  return ok(await createSupplier(input, session, ip), undefined, { status: 201 });
});
