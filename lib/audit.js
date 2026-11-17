import "server-only";
import { prisma, systemPrisma, tryCurrentHospitalId } from "@/lib/db/prisma";

/**
 * Append an audit record. Pass `db` (a transaction client) to make the audit row commit atomically
 * with the change it describes. Never put clinical free text in metadata — identifiers and field
 * names only.
 *
 * Inside a hospital context the row belongs to that hospital (column default + RLS; the application
 * role can only INSERT/SELECT audit rows, never change them). Outside one (sign-in, platform
 * administration) the row is written by the system client with an explicit `hospitalId`, which is
 * NULL for platform-level events.
 */
export async function audit({ userId, action, entityType, entityId, metadata, ipAddress, hospitalId }, db) {
  const data = { userId: userId ?? null, action, entityType, entityId: entityId ?? null, metadata: metadata ?? undefined, ipAddress: ipAddress ?? null };
  if (db) { await db.auditLog.create({ data }); return; }
  if (hospitalId === undefined && (await tryCurrentHospitalId())) { await prisma.auditLog.create({ data }); return; }
  await systemPrisma.auditLog.create({ data: { ...data, hospitalId: hospitalId ?? null } });
}
