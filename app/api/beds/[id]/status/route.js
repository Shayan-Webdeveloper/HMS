import { route } from "@/lib/api/handler";
import { bedStatusSchema } from "@/lib/validation/inpatient";
import { changeBedStatus } from "@/lib/services/wards";

export const POST = route({ permission: "wards:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(bedStatusSchema);
  return changeBedStatus(params.id, input, session, ip);
});
