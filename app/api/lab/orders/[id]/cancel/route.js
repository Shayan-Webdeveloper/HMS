import { route } from "@/lib/api/handler";
import { reasonSchema } from "@/lib/validation/lab";
import { cancelLabOrder } from "@/lib/services/lab";

// Lab staff, or the ordering doctor (checked in the service).
export const POST = route({ permission: ["lab:process", "lab:order"] }, async ({ params, body, session, ip }) => {
  const input = await body(reasonSchema);
  return cancelLabOrder(params.id, input, session, ip);
});
