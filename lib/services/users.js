import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { forbidden, notFound, invalidState, conflict, badRequest } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { SETTING_DEFAULTS } from "@/lib/services/settings";
import { SETTING_SCHEMAS, LAB_SETTING_DEFAULTS } from "@/lib/validation/settings";
import { dayRangeUtc } from "@/lib/utils/time";

// ───────────────────────────── Guard rules (pure, unit-tested) ─────────────────────────────

export const SUPER_ADMIN = "SUPER_ADMIN";
export const PATIENT_ROLE = "PATIENT";
/** Permissions the SUPER_ADMIN role must always keep, so the system can never be locked out. */
export const SUPER_ADMIN_REQUIRED = ["users:manage", "settings:manage"];
export const PORTAL_PERMISSION = "portal:access";

const isSuper = (roles) => roles.includes(SUPER_ADMIN);

/**
 * Decide whether `actor` may set `target`'s roles to `nextRoles`.
 * Returns an error message, or null when allowed.
 *  - only a SUPER_ADMIN may grant or revoke SUPER_ADMIN, or change a SUPER_ADMIN's account;
 *  - nobody may change their own roles, except a SUPER_ADMIN adding roles (they can never drop SUPER_ADMIN);
 *  - the last active SUPER_ADMIN cannot lose the role;
 *  - PATIENT is an exclusive role (portal accounts are separate from staff accounts).
 */
export function checkRoleChange({ actor, target, nextRoles, activeSuperAdmins, knownRoles }) {
  const next = [...new Set(nextRoles)];
  if (!next.length) return "Choose at least one role.";
  if (knownRoles && next.some((r) => !knownRoles.includes(r))) return "Unknown role.";
  if (next.includes(PATIENT_ROLE) && next.length > 1) return "The Patient role cannot be combined with staff roles. Create a separate account.";
  const had = target ? target.roles : [];
  const addsSuper = next.includes(SUPER_ADMIN) && !had.includes(SUPER_ADMIN);
  const removesSuper = had.includes(SUPER_ADMIN) && !next.includes(SUPER_ADMIN);
  const actorSuper = isSuper(actor.roles);
  if ((addsSuper || removesSuper || had.includes(SUPER_ADMIN)) && !actorSuper) return "Only a Super Administrator can change Super Administrator accounts.";
  if (target && target.id === actor.id) {
    if (removesSuper) return "You cannot remove your own Super Administrator role.";
    if (!actorSuper) return "You cannot change your own roles. Ask another administrator.";
  }
  if (removesSuper && target?.isActive && activeSuperAdmins <= 1) return "This is the last active Super Administrator. Assign the role to someone else first.";
  return null;
}

/** May `actor` activate/deactivate `target`? */
export function checkStatusChange({ actor, target, active, activeSuperAdmins }) {
  if (target.id === actor.id) return "You cannot change the status of your own account.";
  if (isSuper(target.roles) && !isSuper(actor.roles)) return "Only a Super Administrator can change Super Administrator accounts.";
  if (!active && isSuper(target.roles) && target.isActive && activeSuperAdmins <= 1) return "This is the last active Super Administrator and cannot be deactivated.";
  return null;
}

/** Validate a role's permission set. Returns an error message or null. */
export function validateRolePermissions(roleKey, keys, allKeys) {
  const unknown = keys.filter((k) => !allKeys.includes(k));
  if (unknown.length) return `Unknown permission: ${unknown.join(", ")}`;
  if (roleKey === PATIENT_ROLE) {
    if (keys.some((k) => k !== PORTAL_PERMISSION)) return "The Patient role may only hold portal:access.";
    return null;
  }
  if (keys.includes(PORTAL_PERMISSION)) return "portal:access is reserved for the Patient role.";
  if (roleKey === SUPER_ADMIN) {
    const missing = SUPER_ADMIN_REQUIRED.filter((k) => !keys.includes(k));
    if (missing.length) return `The Super Administrator role must keep ${missing.join(" and ")}.`;
  }
  return null;
}

export function diffKeys(before, after) {
  const b = new Set(before), a = new Set(after);
  return { added: [...a].filter((k) => !b.has(k)).sort(), removed: [...b].filter((k) => !a.has(k)).sort() };
}

/** Random temporary password that satisfies the password policy (letters + digits, 14 chars). */
export function generateTempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  for (;;) {
    const bytes = crypto.randomBytes(14);
    const pw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

// ───────────────────────────── Users ─────────────────────────────

const userSelect = {
  id: true, email: true, name: true, isActive: true, mustChangePassword: true, lastLoginAt: true, lockedUntil: true, createdAt: true,
  roles: { select: { role: { select: { key: true, name: true } } } },
  staff: { select: { id: true, employeeNo: true, position: true } },
  patientLink: { select: { id: true, verifiedAt: true, patient: { select: { id: true, mrn: true, firstName: true, lastName: true } } } },
};

const shapeUser = (u) => ({ ...u, roles: u.roles.map((r) => r.role.key), roleNames: u.roles.map((r) => r.role.name) });

export async function listUsers({ q, role, status, page, pageSize }) {
  const where = {};
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }];
  if (role) where.roles = { some: { role: { key: role } } };
  if (status === "active") where.isActive = true;
  if (status === "inactive") where.isActive = false;
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: [{ isActive: "desc" }, { name: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: userSelect }),
  ]);
  return { rows: rows.map(shapeUser), meta: pageMeta(total, page, pageSize) };
}

export async function getUser(id) {
  const u = await prisma.user.findUnique({ where: { id }, select: userSelect });
  return u ? shapeUser(u) : null;
}

export async function listRoles() {
  return prisma.role.findMany({ orderBy: { name: "asc" }, select: { id: true, key: true, name: true, description: true } });
}

async function activeSuperAdminCount(db = prisma) {
  return db.user.count({ where: { isActive: true, roles: { some: { role: { key: SUPER_ADMIN } } } } });
}

async function findPatientForLink(db, mrn, excludeUserId) {
  const patient = await db.patient.findUnique({ where: { mrn }, select: { id: true, mrn: true, status: true, userLink: { select: { userId: true } } } });
  if (!patient) throw notFound(`No patient with MRN ${mrn}.`);
  if (patient.status !== "ACTIVE") throw invalidState("Only active patient records can be linked to a portal account.");
  if (patient.userLink && patient.userLink.userId !== excludeUserId) throw conflict("This patient is already linked to another portal account.");
  return patient;
}

export async function createUser(input, session, ip) {
  const roles = await prisma.role.findMany({ select: { id: true, key: true } });
  const err = checkRoleChange({ actor: { id: session.user.id, roles: session.roles }, target: null, nextRoles: input.roles, activeSuperAdmins: 0, knownRoles: roles.map((r) => r.key) });
  if (err) throw err.startsWith("Only") ? forbidden(err) : invalidState(err);
  if (input.patientMrn && !(input.roles.length === 1 && input.roles[0] === PATIENT_ROLE)) throw badRequest("Only Patient accounts can be linked to a patient record.", { patientMrn: "Only for the Patient role" });
  const exists = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (exists) throw conflict("A user with this email already exists.", { email: "Email already in use" });
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const roleIds = roles.filter((r) => input.roles.includes(r.key)).map((r) => r.id);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash, mustChangePassword: true, roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    let linkedPatientId = null;
    if (input.patientMrn) {
      const p = await findPatientForLink(tx, input.patientMrn.toUpperCase(), u.id);
      await tx.patientUserLink.create({ data: { patientId: p.id, userId: u.id, verifiedAt: new Date() } });
      linkedPatientId = p.id;
    }
    await audit({ userId: session.user.id, action: "user.create", entityType: "User", entityId: u.id, metadata: { roles: input.roles, linkedPatientId }, ipAddress: ip }, tx);
    return u;
  });
  return { user: await getUser(user.id), temporaryPassword };
}

export async function updateUser(id, input, session, ip) {
  const target = await getUser(id);
  if (!target) throw notFound();
  const data = {};
  const metadata = {};
  let roleChange = null;
  if (input.roles) {
    const roles = await prisma.role.findMany({ select: { id: true, key: true } });
    const err = checkRoleChange({ actor: { id: session.user.id, roles: session.roles }, target, nextRoles: input.roles, activeSuperAdmins: await activeSuperAdminCount(), knownRoles: roles.map((r) => r.key) });
    if (err) throw err.startsWith("Only") ? forbidden(err) : invalidState(err);
    if (target.patientLink && !(input.roles.length === 1 && input.roles[0] === PATIENT_ROLE)) throw invalidState("This account is linked to a patient record. Unlink it before assigning staff roles.");
    roleChange = { diff: diffKeys(target.roles, input.roles), ids: roles.filter((r) => input.roles.includes(r.key)).map((r) => r.id) };
    metadata.addedRoles = roleChange.diff.added;
    metadata.removedRoles = roleChange.diff.removed;
  } else if (target.roles.includes(SUPER_ADMIN) && !session.roles.includes(SUPER_ADMIN)) {
    throw forbidden("Only a Super Administrator can change Super Administrator accounts.");
  }
  if (input.name !== undefined && input.name !== target.name) { data.name = input.name; metadata.fields = ["name"]; }
  if (!Object.keys(data).length && (!roleChange || (!roleChange.diff.added.length && !roleChange.diff.removed.length))) return target;
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.user.update({ where: { id }, data });
    if (roleChange) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roleChange.ids.map((roleId) => ({ userId: id, roleId })) });
      // Re-check inside the transaction so two concurrent edits cannot remove the last Super Administrator.
      if (roleChange.diff.removed.includes(SUPER_ADMIN) && (await activeSuperAdminCount(tx)) < 1) throw invalidState("At least one active Super Administrator is required.");
    }
    await audit({ userId: session.user.id, action: roleChange ? "user.roles_update" : "user.update", entityType: "User", entityId: id, metadata, ipAddress: ip }, tx);
  });
  return getUser(id);
}

export async function setUserActive(id, active, reason, session, ip) {
  const target = await getUser(id);
  if (!target) throw notFound();
  const err = checkStatusChange({ actor: { id: session.user.id, roles: session.roles }, target, active, activeSuperAdmins: await activeSuperAdminCount() });
  if (err) throw err.startsWith("Only") ? forbidden(err) : invalidState(err);
  if (target.isActive === active) throw invalidState(active ? "The account is already active." : "The account is already deactivated.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.user.updateMany({ where: { id, isActive: !active }, data: active ? { isActive: true, failedLoginCount: 0, lockedUntil: null } : { isActive: false } });
    if (!r.count) throw conflict("The account was changed by someone else. Refresh and try again.");
    let revoked = 0;
    if (!active) {
      revoked = (await tx.session.deleteMany({ where: { userId: id } })).count; // immediate sign-out everywhere
      if (target.roles.includes(SUPER_ADMIN) && (await activeSuperAdminCount(tx)) < 1) throw invalidState("At least one active Super Administrator is required.");
    }
    await audit({ userId: session.user.id, action: active ? "user.reactivate" : "user.deactivate", entityType: "User", entityId: id, metadata: { reason: reason ?? null, sessionsRevoked: revoked }, ipAddress: ip }, tx);
    return { id, isActive: active, sessionsRevoked: revoked };
  });
}

export async function adminResetPassword(id, session, ip) {
  const target = await getUser(id);
  if (!target) throw notFound();
  if (target.id === session.user.id) throw invalidState("Use Account & password to change your own password.");
  if (target.roles.includes(SUPER_ADMIN) && !session.roles.includes(SUPER_ADMIN)) throw forbidden("Only a Super Administrator can change Super Administrator accounts.");
  if (!target.isActive) throw invalidState("Reactivate the account before resetting its password.");
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
    const n = (await tx.session.deleteMany({ where: { userId: id } })).count;
    await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    await audit({ userId: session.user.id, action: "user.password_reset", entityType: "User", entityId: id, metadata: { sessionsRevoked: n }, ipAddress: ip }, tx);
    return n;
  });
  return { temporaryPassword, sessionsRevoked: revoked };
}

export async function linkPatient(id, mrn, session, ip) {
  const target = await getUser(id);
  if (!target) throw notFound();
  if (!(target.roles.length === 1 && target.roles[0] === PATIENT_ROLE)) throw invalidState("Only accounts with the Patient role (and no other role) can be linked to a patient record.");
  return prisma.$transaction(async (tx) => {
    const p = await findPatientForLink(tx, mrn, id);
    const link = await tx.patientUserLink.upsert({ where: { userId: id }, create: { userId: id, patientId: p.id, verifiedAt: new Date() }, update: { patientId: p.id, verifiedAt: new Date() } });
    // Revoke existing sessions so the new link applies from the next sign-in only.
    await tx.session.deleteMany({ where: { userId: id } });
    await audit({ userId: session.user.id, action: "user.patient_link", entityType: "User", entityId: id, metadata: { patientId: p.id, previousPatientId: target.patientLink?.patient.id ?? null }, ipAddress: ip }, tx);
    return { id: link.id, patientId: p.id, mrn: p.mrn };
  });
}

export async function unlinkPatient(id, session, ip) {
  const target = await getUser(id);
  if (!target) throw notFound();
  if (!target.patientLink) throw invalidState("This account is not linked to a patient record.");
  return prisma.$transaction(async (tx) => {
    await tx.patientUserLink.delete({ where: { userId: id } });
    await tx.session.deleteMany({ where: { userId: id } });
    await audit({ userId: session.user.id, action: "user.patient_unlink", entityType: "User", entityId: id, metadata: { patientId: target.patientLink.patient.id }, ipAddress: ip }, tx);
    return { unlinked: true };
  });
}

// ───────────────────────────── Roles & permissions ─────────────────────────────

export async function getPermissionMatrix() {
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({ orderBy: { name: "asc" }, select: { id: true, key: true, name: true, description: true, isSystem: true, permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { users: true } } } }),
    prisma.permission.findMany({ orderBy: [{ resource: "asc" }, { action: "asc" }], select: { id: true, key: true, resource: true, action: true, description: true } }),
  ]);
  const order = [SUPER_ADMIN, "HOSPITAL_ADMIN"];
  roles.sort((a, b) => (order.indexOf(a.key) === -1 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) === -1 ? 99 : order.indexOf(b.key)) || (a.key === PATIENT_ROLE) - (b.key === PATIENT_ROLE) || a.name.localeCompare(b.name));
  return {
    roles: roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, users: r._count.users, permissions: r.permissions.map((p) => p.permission.key).sort() })),
    permissions,
  };
}

export async function setRolePermissions(roleKey, keys, session, ip) {
  if (!session.roles.includes(SUPER_ADMIN)) throw forbidden("Only a Super Administrator can edit role permissions.");
  const role = await prisma.role.findUnique({ where: { key: roleKey }, select: { id: true, key: true, permissions: { select: { permission: { select: { key: true } } } } } });
  if (!role) throw notFound("Role not found");
  const all = await prisma.permission.findMany({ select: { id: true, key: true } });
  const next = [...new Set(keys)];
  const err = validateRolePermissions(roleKey, next, all.map((p) => p.key));
  if (err) throw invalidState(err);
  const before = role.permissions.map((p) => p.permission.key);
  const { added, removed } = diffKeys(before, next);
  if (!added.length && !removed.length) return { key: roleKey, added, removed, permissions: before.sort() };
  const idOf = new Map(all.map((p) => [p.key, p.id]));
  await prisma.$transaction(async (tx) => {
    if (removed.length) await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { in: removed.map((k) => idOf.get(k)) } } });
    if (added.length) await tx.rolePermission.createMany({ data: added.map((k) => ({ roleId: role.id, permissionId: idOf.get(k) })), skipDuplicates: true });
    await audit({ userId: session.user.id, action: "role.permissions_update", entityType: "Role", entityId: role.id, metadata: { role: roleKey, added, removed }, ipAddress: ip }, tx);
  });
  return { key: roleKey, added, removed, permissions: next.sort() };
}

// ───────────────────────────── Settings ─────────────────────────────

export async function updateHospitalProfile(input, session, ip) {
  const h = await prisma.hospital.findFirst({ orderBy: { createdAt: "asc" } });
  if (!h) throw notFound("Hospital is not configured.");
  const data = { name: input.name, address: input.address ?? null, phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, timezone: input.timezone, currency: input.currency, locale: input.locale };
  const changed = Object.keys(data).filter((k) => String(h[k] ?? "") !== String(data[k] ?? ""));
  if (!changed.length) return h;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.hospital.update({ where: { id: h.id }, data });
    // Keep the descriptive SystemSetting mirrors in step with the Hospital row (single source: the row).
    const profile = await tx.systemSetting.findUnique({ where: { hospitalId_key: { hospitalId: h.id, key: "hospital.profile" } } });
    const profileValue = { ...SETTING_DEFAULTS["hospital.profile"], ...(profile?.value || {}), name: data.name, address: data.address ?? "", phone: data.phone ?? "", email: data.email ?? "" };
    await tx.systemSetting.upsert({ where: { hospitalId_key: { hospitalId: h.id, key: "hospital.profile" } }, create: { hospitalId: h.id, key: "hospital.profile", value: profileValue, updatedById: session.user.id }, update: { value: profileValue, updatedById: session.user.id } });
    const loc = await tx.systemSetting.findUnique({ where: { hospitalId_key: { hospitalId: h.id, key: "locale" } } });
    const locValue = { ...SETTING_DEFAULTS.locale, ...(loc?.value || {}), timezone: data.timezone, currency: data.currency, locale: data.locale };
    await tx.systemSetting.upsert({ where: { hospitalId_key: { hospitalId: h.id, key: "locale" } }, create: { hospitalId: h.id, key: "locale", value: locValue, updatedById: session.user.id }, update: { value: locValue, updatedById: session.user.id } });
    await audit({ userId: session.user.id, action: "settings.hospital_update", entityType: "Hospital", entityId: h.id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return updated;
  });
}

export function settingDefaults(key) {
  return key === "lab" ? { ...LAB_SETTING_DEFAULTS, ...(SETTING_DEFAULTS.lab || {}) } : SETTING_DEFAULTS[key] || {};
}

/** Upsert a SystemSetting, merging the validated value over defaults and the stored value. */
export async function updateSetting(key, input, session, ip) {
  if (!SETTING_SCHEMAS[key]) throw notFound("Unknown setting");
  const h = await prisma.hospital.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!h) throw notFound("Hospital is not configured.");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.systemSetting.findUnique({ where: { hospitalId_key: { hospitalId: h.id, key } } });
    const before = { ...settingDefaults(key), ...(existing?.value || {}) };
    const value = { ...before, ...input };
    const changed = Object.keys(input).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(value[k]));
    await tx.systemSetting.upsert({
      where: { hospitalId_key: { hospitalId: h.id, key } },
      create: { hospitalId: h.id, key, value, updatedById: session.user.id },
      update: { value, updatedById: session.user.id },
    });
    await audit({ userId: session.user.id, action: "settings.update", entityType: "SystemSetting", entityId: key, metadata: { key, fields: changed }, ipAddress: ip }, tx);
    return { key, value, changed };
  });
}

export async function getSettingMeta() {
  const rows = await prisma.systemSetting.findMany({ select: { key: true, updatedAt: true, updatedById: true } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.updatedById).filter(Boolean) } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return Object.fromEntries(rows.map((r) => [r.key, { updatedAt: r.updatedAt, updatedBy: r.updatedById ? name.get(r.updatedById) ?? "Unknown user" : null }]));
}

// ───────────────────────────── Audit log ─────────────────────────────

export function auditWhere({ user, action, entityType, entityId, from, to }, tz) {
  const where = {};
  if (user) where.user = { OR: [{ name: { contains: user, mode: "insensitive" } }, { email: { contains: user, mode: "insensitive" } }] };
  if (action) where.action = { startsWith: action };
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.createdAt.lt = dayRangeUtc(to, tz)[1];
  }
  return where;
}

export async function listAuditLogs(filters, tz) {
  const where = auditWhere(filters, tz);
  const { page, pageSize } = filters;
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { id: true, name: true, email: true } } } }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function auditEntityTypes() {
  const rows = await prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } });
  return rows.map((r) => r.entityType);
}
