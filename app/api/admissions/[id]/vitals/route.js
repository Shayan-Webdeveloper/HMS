import { route, ok } from "@/lib/api/handler";
import { vitalsSchema } from "@/lib/validation/inpatient";
import { recordVitals, listVitals } from "@/lib/services/admissions";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "clinical:read" }, async ({ params }) => {
  const a = await prisma.admission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!a) throw notFound();
  return listVitals(params.id);
});

export const POST = route({ permission: "vitals:create" }, async ({ params, body, session, ip }) => {
  const input = await body(vitalsSchema);
  return ok(await recordVitals(params.id, input, session, ip), undefined, { status: 201 });
});
