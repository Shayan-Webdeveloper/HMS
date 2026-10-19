import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { historySchema } from "@/lib/validation/patients";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

export const POST = route({ permission: ["encounters:create", "nursing:create"] }, async ({ params, body, session, ip }) => {
  const d = await body(historySchema);
  const p = await prisma.patient.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!p) throw notFound();
  const h = await prisma.medicalHistory.create({ data: { patientId: p.id, category: d.category, description: d.description, onsetDate: d.onsetDate ? new Date(d.onsetDate) : null, recordedById: session.user.id } });
  await audit({ userId: session.user.id, action: "history.create", entityType: "Patient", entityId: p.id, ipAddress: ip });
  return h;
});
