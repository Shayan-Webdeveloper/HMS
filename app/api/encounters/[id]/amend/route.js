import { route, ok } from "@/lib/api/handler";
import { amendSchema } from "@/lib/validation/encounters";
import { amendEncounter } from "@/lib/services/encounters";

export const POST = route({ permission: "encounters:amend" }, async ({ params, body, session, ip }) => {
  const input = await body(amendSchema);
  const n = await amendEncounter(params.id, input, session, ip);
  return ok(n, undefined, { status: 201 });
});
