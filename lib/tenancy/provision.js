// Hospital provisioning shared by the platform console, the setup scripts and the seed.
// `db` must be the OWNER (system) client — these functions create rows for a hospital that is not the
// caller's context, so every hospital-owned row gets an explicit hospitalId. Not "server-only" so the
// CLI scripts can use it; never import it from client components.
import { ROLES, PERMISSIONS } from "../permissions/matrix.js";

export const HOSPITAL_ROLE_KEYS = Object.keys(ROLES);

/** Make sure every permission and role in lib/permissions/matrix.js exists (additive; never edits grants). */
export async function ensurePermissionCatalogue(db) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    const [resource, action] = key.split(":");
    await db.permission.upsert({ where: { key }, update: { description }, create: { key, resource, action, description } });
  }
  for (const [key, r] of Object.entries(ROLES)) {
    await db.role.upsert({ where: { key }, update: {}, create: { key, name: r.name, description: r.description } });
  }
}

/** Apply the default role → permission grants to ONE hospital (only adds missing grants). */
export async function applyDefaultGrants(db, hospitalId) {
  const [roles, perms] = await Promise.all([db.role.findMany({ select: { id: true, key: true } }), db.permission.findMany({ select: { id: true, key: true } })]);
  const roleId = new Map(roles.map((r) => [r.key, r.id]));
  const permId = new Map(perms.map((p) => [p.key, p.id]));
  const data = Object.entries(ROLES).flatMap(([key, r]) =>
    r.permissions.filter((p) => permId.has(p) && roleId.has(key)).map((p) => ({ hospitalId, roleId: roleId.get(key), permissionId: permId.get(p) })));
  await db.rolePermission.createMany({ data, skipDuplicates: true });
}

/**
 * Create a hospital tenant with its main facility, base settings and default role grants.
 * @returns the Hospital row
 */
export async function provisionHospital(db, { name, code, timezone = "Asia/Karachi", currency = "PKR", locale = "en-PK", address = null, phone = null, email = null }) {
  await ensurePermissionCatalogue(db);
  return db.$transaction(async (tx) => {
    const hospital = await tx.hospital.create({ data: { name, code: code.toUpperCase(), timezone, currency, locale, address, phone, email } });
    await tx.facility.create({ data: { hospitalId: hospital.id, name: "Main Campus", code: "MAIN" } });
    await tx.systemSetting.createMany({
      data: [
        { hospitalId: hospital.id, key: "hospital.profile", value: { name, address: address ?? "", phone: phone ?? "", email: email ?? "", logoText: code.toUpperCase().slice(0, 4) } },
        { hospitalId: hospital.id, key: "locale", value: { timezone, currency, locale, dateFormat: "dd MMM yyyy" } },
      ],
    });
    await applyDefaultGrants(tx, hospital.id);
    return hospital;
  });
}

/** Give `userId` (active) membership of `hospitalId` with `roleKeys` there. Additive. */
export async function grantMembership(db, { hospitalId, userId, roleKeys }) {
  const roles = await db.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true, key: true } });
  if (roles.length !== new Set(roleKeys).size) throw new Error("Unknown role");
  await db.hospitalMembership.upsert({
    where: { hospitalId_userId: { hospitalId, userId } },
    update: { isActive: true },
    create: { hospitalId, userId, isActive: true },
  });
  await db.userRole.createMany({ data: roles.map((r) => ({ hospitalId, userId, roleId: r.id })), skipDuplicates: true });
}
