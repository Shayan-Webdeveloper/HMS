import { z } from "zod";
import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { unauthorized } from "@/lib/errors";

const q = z.object({ limit: z.coerce.number().int().min(1).max(100).optional().default(20), unread: z.enum(["1", "0"]).optional(), category: z.string().max(30).optional() });

// Available to staff and patients alike — always scoped to the signed-in user.
export const GET = route({ public: true }, async ({ session, query }) => {
  if (!session) throw unauthorized();
  const { limit, unread, category } = query(q);
  const where = { userId: session.user.id, ...(unread === "1" ? { readAt: null } : {}), ...(category ? { category } : {}) };
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
  ]);
  return { items, unread: unreadCount };
});
