import { route } from "@/lib/api/handler";
import { getClaimDetail } from "@/lib/services/insurance";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "insurance:read" }, async ({ params }) => {
  const c = await getClaimDetail(params.id);
  if (!c) throw notFound("Claim not found");
  return c;
});
