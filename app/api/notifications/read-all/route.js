import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { unauthorized } from "@/lib/errors";

export const POST = route({ public: true }, async ({ session }) => {
  if (!session) throw unauthorized();
  const r = await prisma.notification.updateMany({ where: { userId: session.user.id, readAt: null }, data: { readAt: new Date() } });
  return { updated: r.count };
});
