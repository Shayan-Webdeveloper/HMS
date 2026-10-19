import { route, ok } from "@/lib/api/handler";
import { marSchema } from "@/lib/validation/inpatient";
import { recordAdministration, listAdministrations, listAdministrableItems } from "@/lib/services/admissions";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "clinical:read" }, async ({ params }) => {
  const a = await prisma.admission.findUnique({ where: { id: params.id }, select: { id: true, patientId: true } });
  if (!a) throw notFound();
  const [administrations, items] = await Promise.all([listAdministrations(params.id), listAdministrableItems(a.patientId)]);
  return { administrations, items };
});

export const POST = route({ permission: "nursing:create" }, async ({ params, body, session, ip }) => {
  const input = await body(marSchema);
  return ok(await recordAdministration(params.id, input, session, ip), undefined, { status: 201 });
});
