import { z } from "zod";
import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { allergySchema } from "@/lib/validation/patients";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const POST = route({ permission: ["vitals:create", "encounters:create", "patients:update"] }, async ({ params, body, session, ip }) => {
  const data = await body(allergySchema);
  const p = await prisma.patient.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!p) throw notFound();
  const a = await prisma.allergy.create({ data: { ...data, patientId: p.id, recordedById: session.user.id } });
  await audit({ userId: session.user.id, action: "allergy.create", entityType: "Patient", entityId: p.id, ipAddress: ip });
  return a;
});

const del = z.object({ allergyId: z.string().min(1) });
// Allergies are deactivated (not deleted) so history is preserved.
export const DELETE = route({ permission: ["encounters:create", "patients:update"] }, async ({ params, body, session, ip }) => {
  const { allergyId } = await body(del);
  const r = await prisma.allergy.updateMany({ where: { id: allergyId, patientId: params.id }, data: { isActive: false } });
  if (!r.count) throw notFound();
  await audit({ userId: session.user.id, action: "allergy.deactivate", entityType: "Patient", entityId: params.id, metadata: { allergyId }, ipAddress: ip });
  return { ok: true };
});
