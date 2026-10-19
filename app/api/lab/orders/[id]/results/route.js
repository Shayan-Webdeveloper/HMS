import { route } from "@/lib/api/handler";
import { resultEntrySchema } from "@/lib/validation/lab";
import { enterResults } from "@/lib/services/lab";

export const POST = route({ permission: "lab:process" }, async ({ params, body, session, ip }) => {
  const input = await body(resultEntrySchema);
  return enterResults(params.id, input, session, ip);
});
