import { route, ok } from "@/lib/api/handler";
import { encounterListQuery, encounterCreateSchema } from "@/lib/validation/encounters";
import { listEncounters, createEncounter } from "@/lib/services/encounters";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "clinical:read" }, async ({ query }) => {
  const q = query(encounterListQuery);
  const h = await getHospital();
  const { rows, meta } = await listEncounters(q, h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "encounters:create" }, async ({ body, session, ip }) => {
  const input = await body(encounterCreateSchema);
  const r = await createEncounter(input, session, ip);
  return ok(r, undefined, { status: r.reopened ? 200 : 201 });
});
