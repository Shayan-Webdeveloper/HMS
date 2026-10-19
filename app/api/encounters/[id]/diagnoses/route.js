import { route, ok } from "@/lib/api/handler";
import { diagnosisSchema } from "@/lib/validation/encounters";
import { addDiagnosis } from "@/lib/services/encounters";

export const POST = route({ permission: "encounters:create" }, async ({ params, body, session, ip }) => {
  const input = await body(diagnosisSchema);
  const d = await addDiagnosis(params.id, input, session, ip);
  return ok(d, undefined, { status: 201 });
});
