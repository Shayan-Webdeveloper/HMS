import { route, ok } from "@/lib/api/handler";
import { policyListQuery, policySchema } from "@/lib/validation/insurance";
import { listPolicies, createPolicy } from "@/lib/services/insurance";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "insurance:read" }, async ({ query }) => {
  const h = await getHospital();
  const { rows, meta } = await listPolicies(query(policyListQuery), h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "insurance:manage" }, async ({ body, session, ip }) => {
  const input = await body(policySchema);
  return ok(await createPolicy(input, session, ip), undefined, { status: 201 });
});
