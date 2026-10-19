import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { availabilitySchema } from "@/lib/validation/staff";
import { setAvailability } from "@/lib/services/staff";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: ["staff:read", "appointments:read"] }, async ({ params }) => {
  const doc = await prisma.doctorProfile.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!doc) throw notFound();
  return prisma.doctorAvailability.findMany({ where: { doctorId: params.id }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }], select: { id: true, weekday: true, startTime: true, endTime: true } });
});

/** Replaces the doctor's whole weekly template atomically. */
export const PUT = route({ permission: "staff:manage" }, async ({ params, body, session, ip }) => {
  const { windows } = await body(availabilitySchema);
  return setAvailability(params.id, windows, session, ip);
});
