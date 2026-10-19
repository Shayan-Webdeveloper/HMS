import { route } from "@/lib/api/handler";
import { encounterUpdateSchema } from "@/lib/validation/encounters";
import { getEncounter, updateEncounter } from "@/lib/services/encounters";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";

export const GET = route({ permission: "clinical:read" }, async ({ params, session, ip }) => {
  const e = await getEncounter(params.id);
  if (!e) throw notFound();
  await audit({ userId: session.user.id, action: "encounter.view", entityType: "Encounter", entityId: e.id, ipAddress: ip });
  return e;
});

export const PATCH = route({ permission: "encounters:create" }, async ({ params, body, session, ip }) => {
  const input = await body(encounterUpdateSchema);
  return updateEncounter(params.id, input, session, ip);
});
