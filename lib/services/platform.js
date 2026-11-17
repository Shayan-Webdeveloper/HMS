import "server-only";
import { z } from "zod";
import { systemPrisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { generateTempPassword, PATIENT_ROLE } from "@/lib/services/users";
import { provisionHospital, grantMembership, HOSPITAL_ROLE_KEYS } from "@/lib/tenancy/provision";
import { conflict, notFound, invalidState, forbidden } from "@/lib/errors";

// Platform administration (role: Platform Administrator — above hospitals).
//
// What a Platform Administrator CAN do:
//   * list hospitals (name, code, status, member count) and create / deactivate / reactivate them;
//   * appoint a hospital's administrators (new account or an existing account by email);
//   * reset the password of an account (needed for accounts shared by several hospitals);
//   * read platform-level audit events (hospital management, sign-ins without a hospital).
// What it CANNOT do: read or change any hospital's patients, clinical, financial, HR or operational
// records. This module only touches Hospital, HospitalMembership/UserRole (to appoint admins), User,
// Session and platform AuditLog rows — always with explicit filters — and platform routes never get a
// hospital context (lib/api/handler.js), so the hospital-scoped client fails closed there.

export const hospitalCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter the hospital name").max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "2–12 letters, digits or dashes"),
  timezone: z.string().trim().min(3).max(64).default("Asia/Karachi"),
  currency: z.string().trim().toUpperCase().length(3).default("PKR"),
  locale: z.string().trim().min(2).max(20).default("en-PK"),
  address: z.string().trim().max(300).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.email().trim().toLowerCase().max(200).optional().nullable().or(z.literal("").transform(() => null)),
});

export const hospitalStatusSchema = z.object({ active: z.boolean(), reason: z.string().trim().min(3, "Give a reason").max(300) });

const ADMIN_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN"];
export const memberSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase().max(200),
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ADMIN_ROLES).default("SUPER_ADMIN"),
});

export const resetSchema = z.object({ email: z.email().trim().toLowerCase().max(200) });

export async function listHospitals() {
  const rows = await systemPrisma.hospital.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true, name: true, code: true, isActive: true, deactivatedAt: true, createdAt: true, timezone: true, currency: true,
      _count: { select: { memberships: { where: { isActive: true } } } },
    },
  });
  return rows.map(({ _count, ...h }) => ({ ...h, activeMembers: _count.memberships }));
}

export async function createHospital(input, session, ip) {
  const exists = await systemPrisma.hospital.findUnique({ where: { code: input.code }, select: { id: true } });
  if (exists) throw conflict("A hospital with this code already exists.", { code: "Code already in use" });
  const h = await provisionHospital(systemPrisma, input);
  await audit({ userId: session.user.id, action: "platform.hospital_create", entityType: "Hospital", entityId: h.id, metadata: { code: h.code }, ipAddress: ip, hospitalId: null });
  return h;
}

export async function setHospitalActive(id, { active, reason }, session, ip) {
  const h = await systemPrisma.hospital.findUnique({ where: { id }, select: { id: true, isActive: true, code: true } });
  if (!h) throw notFound("Hospital not found");
  if (h.isActive === active) throw invalidState(active ? "The hospital is already active." : "The hospital is already deactivated.");
  const revoked = await systemPrisma.$transaction(async (tx) => {
    await tx.hospital.update({ where: { id }, data: { isActive: active, deactivatedAt: active ? null : new Date() } });
    // Deactivation signs everyone out of this hospital immediately; sessions re-verify on every request too.
    return active ? 0 : (await tx.session.deleteMany({ where: { activeHospitalId: id } })).count;
  });
  await audit({ userId: session.user.id, action: active ? "platform.hospital_activate" : "platform.hospital_deactivate", entityType: "Hospital", entityId: id, metadata: { code: h.code, reason, sessionsRevoked: revoked }, ipAddress: ip, hospitalId: null });
  return { id, isActive: active, sessionsRevoked: revoked };
}

/**
 * Appoint an administrator of a hospital. A new email gets a new account with a one-time temporary
 * password; an existing account is given membership of this hospital (explicit cross-hospital grant).
 */
export async function addHospitalAdmin(hospitalId, input, session, ip) {
  if (!ADMIN_ROLES.includes(input.role) || !HOSPITAL_ROLE_KEYS.includes(input.role)) throw invalidState("Unknown role.");
  const h = await systemPrisma.hospital.findUnique({ where: { id: hospitalId }, select: { id: true, isActive: true } });
  if (!h) throw notFound("Hospital not found");
  const existing = await systemPrisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, platformRole: true, roles: { select: { role: { select: { key: true } } } } },
  });
  let temporaryPassword = null;
  let userId;
  if (existing) {
    if (existing.platformRole) throw forbidden("Platform Administrator accounts cannot be hospital members.");
    if (existing.roles.some((r) => r.role.key === PATIENT_ROLE)) throw invalidState("This email belongs to a patient portal account and cannot be given staff roles.");
    userId = existing.id;
    await grantMembership(systemPrisma, { hospitalId, userId, roleKeys: [input.role] });
  } else {
    if (!input.name) throw invalidState("Enter the administrator's name for a new account.");
    temporaryPassword = generateTempPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    userId = await systemPrisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, mustChangePassword: true }, select: { id: true } });
      await grantMembership(tx, { hospitalId, userId: u.id, roleKeys: [input.role] });
      return u.id;
    });
  }
  await audit({ userId: session.user.id, action: "platform.hospital_admin_add", entityType: "User", entityId: userId, metadata: { hospitalId, role: input.role, newAccount: !existing }, ipAddress: ip, hospitalId: null });
  return { userId, newAccount: !existing, temporaryPassword };
}

/** Reset any non-platform account's password (e.g. accounts shared by several hospitals). */
export async function platformResetPassword({ email }, session, ip) {
  const u = await systemPrisma.user.findUnique({ where: { email }, select: { id: true, platformRole: true } });
  if (!u) throw notFound("No account with this email.");
  if (u.platformRole && u.id !== session.user.id) throw forbidden("Platform Administrator passwords can only be changed by their owner.");
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const revoked = await systemPrisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
    await tx.passwordResetToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { usedAt: new Date() } });
    return (await tx.session.deleteMany({ where: { userId: u.id } })).count;
  });
  await audit({ userId: session.user.id, action: "platform.password_reset", entityType: "User", entityId: u.id, metadata: { sessionsRevoked: revoked }, ipAddress: ip, hospitalId: null });
  return { temporaryPassword, sessionsRevoked: revoked };
}

/** Platform-level audit events only (hospitalId IS NULL) — never a hospital's own audit trail. */
export async function listPlatformAudit({ take = 100 } = {}) {
  return systemPrisma.auditLog.findMany({
    where: { hospitalId: null },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, ipAddress: true, user: { select: { name: true, email: true } } },
  });
}
