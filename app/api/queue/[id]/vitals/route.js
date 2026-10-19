import { route, ok } from "@/lib/api/handler";
import { vitalsSchema } from "@/lib/validation/encounters";
import { addQueueVitals } from "@/lib/services/encounters";

export const POST = route({ permission: "vitals:create" }, async ({ params, body, session, ip }) => {
  const input = await body(vitalsSchema);
  const v = await addQueueVitals(params.id, input, session, ip);
  return ok(v, undefined, { status: 201 });
});
