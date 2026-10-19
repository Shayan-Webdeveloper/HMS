import { route } from "@/lib/api/handler";
import { writeOffSchema } from "@/lib/validation/pharmacy";
import { writeOffBatch } from "@/lib/services/pharmacy";

export const POST = route({ permission: "pharmacy:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(writeOffSchema);
  return writeOffBatch(params.id, input, session, ip);
});
