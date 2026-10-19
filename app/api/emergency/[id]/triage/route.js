import { route } from "@/lib/api/handler";
import { triageSchema } from "@/lib/validation/emergency";
import { triageVisit } from "@/lib/services/emergency";

export const POST = route({ permission: "emergency:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(triageSchema);
  return triageVisit(params.id, input, session, ip);
});
