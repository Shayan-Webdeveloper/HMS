import { route } from "@/lib/api/handler";
import { correctionSchema } from "@/lib/validation/lab";
import { correctResult } from "@/lib/services/lab";

export const POST = route({ permission: "lab:process" }, async ({ params, body, session, ip }) => {
  const input = await body(correctionSchema);
  return correctResult(params.id, input, session, ip);
});
