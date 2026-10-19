import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { unauthorized, notFound } from "@/lib/errors";

export const POST = route({ public: true }, async ({ session, params }) => {
  if (!session) throw unauthorized();
  // Ownership enforced in the WHERE clause — another user's id simply matches nothing.
  const r = await prisma.notification.updateMany({ where: { id: params.id, userId: session.user.id }, data: { readAt: new Date() } });
  if (!r.count) throw notFound();
  return { updated: true };
});
