import { route } from "@/lib/api/handler";
import { wardSchema } from "@/lib/validation/inpatient";
import { getWard, updateWard } from "@/lib/services/wards";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "wards:read" }, async ({ params }) => {
  const w = await getWard(params.id);
  if (!w) throw notFound();
  return w;
});

export const PATCH = route({ permission: "wards:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(wardSchema);
  return updateWard(params.id, input, session, ip);
});
