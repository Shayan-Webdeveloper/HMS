import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Append an audit record. Pass `db` (a transaction client) to make the audit
 * row commit atomically with the change it describes.
 * Never put clinical free text in metadata — identifiers and field names only.
 */
export async function audit({ userId, action, entityType, entityId, metadata, ipAddress }, db = prisma) {
  await db.auditLog.create({
    data: { userId: userId ?? null, action, entityType, entityId: entityId ?? null, metadata: metadata ?? undefined, ipAddress: ipAddress ?? null },
  });
}
