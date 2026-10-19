import { route } from "@/lib/api/handler";
import { dispositionSchema } from "@/lib/validation/emergency";
import { setDisposition } from "@/lib/services/emergency";

export const POST = route({ permission: "emergency:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(dispositionSchema);
  return setDisposition(params.id, input, session, ip);
});
