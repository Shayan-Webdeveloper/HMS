import "server-only";
import { prisma, currentHospitalId } from "@/lib/db/prisma";

/**
 * Notify every active member of the CURRENT hospital holding any of the given permissions (as granted
 * in this hospital). Bodies must not contain clinical detail.
 */
export async function notifyPermission(permissionKeys, { category, title, body, link }, db = prisma) {
  const hospitalId = await currentHospitalId();
  const users = await db.user.findMany({
    where: {
      isActive: true,
      memberships: { some: { hospitalId, isActive: true } },
      roles: { some: { hospitalId, role: { permissions: { some: { hospitalId, permission: { key: { in: permissionKeys } } } } } } },
    },
    select: { id: true },
  });
  if (!users.length) return 0;
  await db.notification.createMany({ data: users.map((u) => ({ userId: u.id, category, title, body, link })) });
  return users.length;
}

export async function notifyUser(userId, { category, title, body, link }, db = prisma) {
  if (!userId) return;
  await db.notification.create({ data: { userId, category, title, body, link } });
}
