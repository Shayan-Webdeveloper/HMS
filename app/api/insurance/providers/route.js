import { route, ok } from "@/lib/api/handler";
import { listQuery } from "@/lib/validation/common";
import { providerSchema } from "@/lib/validation/insurance";
import { listProviders, createProvider } from "@/lib/services/insurance";

export const GET = route({ permission: "insurance:read" }, async ({ query }) => {
  const { rows, meta } = await listProviders(query(listQuery));
  return ok(rows, meta);
});

export const POST = route({ permission: "insurance:manage" }, async ({ body, session, ip }) => {
  const input = await body(providerSchema);
  return ok(await createProvider(input, session, ip), undefined, { status: 201 });
});
