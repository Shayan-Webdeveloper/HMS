import "server-only";
import { prisma, systemPrisma, tryCurrentHospitalId, runWithTenant } from "@/lib/db/prisma";

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
  // An explicit hospital (e.g. sign-in or switching hospital): write as the restricted hms_app role in
  // that hospital's context — hospitalId comes from the column default, RLS allows INSERT only.
  if (hospitalId) { await runWithTenant({ hospitalId, userId: userId ?? null }, () => prisma.auditLog.create({ data })); return; }
  // Platform-level events (no hospital) are the only audit rows still written by the owner role.
  await systemPrisma.auditLog.create({ data: { ...data, hospitalId: null } });
}
