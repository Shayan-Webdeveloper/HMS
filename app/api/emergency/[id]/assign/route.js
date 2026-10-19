import { route } from "@/lib/api/handler";
import { assignSchema } from "@/lib/validation/emergency";
import { assignClinician } from "@/lib/services/emergency";

export const POST = route({ permission: "emergency:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(assignSchema);
  return assignClinician(params.id, input, session, ip);
});
