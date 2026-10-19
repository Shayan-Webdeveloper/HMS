import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
import { labTestSchema } from "@/lib/validation/lab";
import { updateLabTest } from "@/lib/services/lab";

export const GET = route({ permission: ["lab:manage", "lab:read"] }, async ({ params }) => {
  const t = await prisma.laboratoryTest.findUnique({ where: { id: params.id } });
  if (!t) throw notFound("Test not found");
  return t;
});

export const PATCH = route({ permission: "lab:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(labTestSchema);
  return updateLabTest(params.id, input, session, ip);
});
