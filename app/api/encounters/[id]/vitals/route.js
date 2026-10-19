import { route, ok } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { vitalsSchema } from "@/lib/validation/encounters";
import { addEncounterVitals } from "@/lib/services/encounters";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "clinical:read" }, async ({ params }) => {
  const e = await prisma.encounter.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!e) throw notFound();
  return prisma.vitalSign.findMany({ where: { encounterId: params.id }, orderBy: { recordedAt: "desc" } });
});

export const POST = route({ permission: "vitals:create" }, async ({ params, body, session, ip }) => {
  const input = await body(vitalsSchema);
  const v = await addEncounterVitals(params.id, input, session, ip);
  return ok(v, undefined, { status: 201 });
});
