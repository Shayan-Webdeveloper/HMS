import { route, ok } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { exceptionSchema } from "@/lib/validation/staff";
import { addScheduleException, listUpcomingExceptions } from "@/lib/services/staff";
import { getHospital } from "@/lib/services/settings";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: ["staff:read", "appointments:read"] }, async ({ params }) => {
  const doc = await prisma.doctorProfile.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!doc) throw notFound();
  return listUpcomingExceptions(params.id);
});

export const POST = route({ permission: "staff:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(exceptionSchema);
  const h = await getHospital();
  const r = await addScheduleException(params.id, input, h.timezone, session, ip);
  return ok(r, undefined, { status: 201 });
});
