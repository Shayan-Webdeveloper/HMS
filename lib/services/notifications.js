import "server-only";
import { prisma } from "@/lib/db/prisma";

/** Notify every active user holding any of the given permissions. Bodies must not contain clinical detail. */
export async function notifyPermission(permissionKeys, { category, title, body, link }, db = prisma) {
  const users = await db.user.findMany({
    where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { key: { in: permissionKeys } } } } } } } },
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
