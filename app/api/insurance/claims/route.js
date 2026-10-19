import { route, ok } from "@/lib/api/handler";
import { claimListQuery, claimCreateSchema } from "@/lib/validation/insurance";
import { listClaims, createClaim } from "@/lib/services/insurance";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "insurance:read" }, async ({ query }) => {
  const h = await getHospital();
  const { rows, meta } = await listClaims(query(claimListQuery), h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "insurance:manage" }, async ({ body, session, ip }) => {
  const input = await body(claimCreateSchema);
  return ok(await createClaim(input, session, ip), undefined, { status: 201 });
});
