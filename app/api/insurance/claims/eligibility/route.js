import { z } from "zod";
import { route } from "@/lib/api/handler";
import { getClaimEligibility } from "@/lib/services/insurance";
import { getHospital } from "@/lib/services/settings";

const schema = z.object({ invoiceId: z.string().min(1).max(64) });

export const GET = route({ permission: "insurance:manage" }, async ({ query }) => {
  const { invoiceId } = query(schema);
  const h = await getHospital();
  return getClaimEligibility(invoiceId, h.timezone);
});
