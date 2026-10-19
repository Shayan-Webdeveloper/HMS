import { z } from "zod";
import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { getUnbilledCharges } from "@/lib/services/billing";
import { getHospital } from "@/lib/services/settings";
import { notFound } from "@/lib/errors";

const schema = z.object({ patientId: z.string().min(1).max(64) });

export const GET = route({ permission: "billing:read" }, async ({ query }) => {
  const { patientId } = query(schema);
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true, status: true } });
  if (!patient || patient.status === "MERGED") throw notFound("Patient not found");
  const h = await getHospital();
  const [{ charges, credits }, drafts] = await Promise.all([
    getUnbilledCharges(patientId, { tz: h.timezone }),
    prisma.invoice.findMany({ where: { patientId, status: "DRAFT" }, orderBy: { createdAt: "desc" }, select: { id: true, invoiceNo: true, total: true, createdAt: true } }),
  ]);
  return { charges, credits, drafts };
});
