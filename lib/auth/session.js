import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { systemPrisma, prisma, runWithTenant } from "@/lib/db/prisma";
import { randomToken, sha256 } from "./tokens";

// Server-side, database-backed sessions:
//  * The browser holds only an opaque random token in an HttpOnly, SameSite=Lax cookie.
//  * The database stores a SHA-256 of the token, so a DB leak does not leak live sessions.
//  * Deactivating a user (globally) or their hospital membership revokes access on the next request.
//
// Multi-hospital: a session works in ONE hospital at a time (Session.activeHospitalId). It is chosen
// only from the user's active memberships of active hospitals and re-verified on every request, so a
// user can never act in a hospital they do not belong to — whatever the client sends.
//
// Session/membership lookups use systemPrisma because they run BEFORE a hospital context exists (a
// user's memberships span hospitals); loadHospitalAccess runs as hms_app in the chosen hospital. Every query filters
// explicitly by the session's user and hospital.

export const SESSION_COOKIE = "hms_session";
const MAX_AGE_H = Number(process.env.SESSION_MAX_AGE_HOURS || 12);
const IDLE_MIN = Number(process.env.SESSION_IDLE_MINUTES || 60);

export const PLATFORM_ADMIN = "PLATFORM_ADMIN";
export const PLATFORM_ROLE_LABELS = { PLATFORM_ADMIN: "Platform Administrator" };

export async function createSession(userId, activeHospitalId = null) {
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + MAX_AGE_H * 3600 * 1000);
  await systemPrisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      activeHospitalId,
      expiresAt,
      ipAddress: clientIp(h),
      userAgent: (h.get("user-agent") || "").slice(0, 300),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await systemPrisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export function clientIp(h) {
  const xff = h.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : h.get("x-real-ip")) || null;
}

/** Active memberships of active hospitals for a user, ordered by hospital name. */
export async function activeMemberships(userId) {
  const rows = await systemPrisma.hospitalMembership.findMany({
    where: { userId, isActive: true, hospital: { isActive: true } },
    select: { hospital: { select: { id: true, name: true, code: true } } },
    orderBy: { hospital: { name: "asc" } },
  });
  return rows.map((r) => r.hospital);
}

/**
 * Roles, permissions, staff and patient records of `userId` inside ONE hospital.
 * Runs as the restricted hms_app role in that hospital's context (RLS applies), not as the owner:
 * callers pass a hospital already verified against the user's active memberships.
 */
export async function loadHospitalAccess(userId, hospitalId) {
  const [userRoles, staff, patientLink] = await runWithTenant({ hospitalId, userId }, () => Promise.all([
    prisma.userRole.findMany({
      where: { userId, hospitalId },
      select: { role: { select: { key: true, permissions: { where: { hospitalId }, select: { permission: { select: { key: true } } } } } } },
    }),
    prisma.staff.findFirst({
      where: { userId, hospitalId },
      select: { id: true, departmentId: true, position: true, employmentStatus: true, department: { select: { name: true } }, doctorProfile: { select: { id: true } } },
    }),
    prisma.patientUserLink.findFirst({ where: { userId, hospitalId }, select: { patientId: true, verifiedAt: true } }),
  ]));
  const roles = userRoles.map((r) => r.role.key);
  const permissions = new Set(userRoles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)));
  return { roles, permissions, staff, patientLink };
}

/**
 * Returns the signed-in session or null. Cached per request.
 * {
 *   sessionId, user, platformRole, isPlatformAdmin,
 *   hospitalId, hospital, hospitals,           // current hospital + all hospitals the user may switch to
 *   roles, permissions:Set, staff, doctorId, patientId, isPatient
 * }
 * Roles/permissions/staff/patient are those of the CURRENT hospital only.
 */
export const getSession = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await systemPrisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      id: true, expiresAt: true, lastSeenAt: true, activeHospitalId: true,
      user: { select: { id: true, email: true, name: true, mustChangePassword: true, isActive: true, platformRole: true } },
    },
  });
  if (!session) return null;
  const now = Date.now();
  const idleExpired = now - session.lastSeenAt.getTime() > IDLE_MIN * 60 * 1000;
  if (session.expiresAt.getTime() < now || idleExpired || !session.user.isActive) {
    await systemPrisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const u = session.user;
  const hospitals = await activeMemberships(u.id);
  // Re-verify the active hospital on every request; fall back to the first available one.
  let hospital = hospitals.find((h) => h.id === session.activeHospitalId) ?? null;
  if (!hospital && hospitals.length && !u.platformRole) hospital = hospitals[0];

  const patch = {};
  if ((hospital?.id ?? null) !== session.activeHospitalId) patch.activeHospitalId = hospital?.id ?? null;
  if (now - session.lastSeenAt.getTime() > 60 * 1000) patch.lastSeenAt = new Date(); // throttle writes
  if (Object.keys(patch).length) {
    await systemPrisma.session.update({ where: { id: session.id }, data: patch }).catch(() => {});
  }

  const access = hospital
    ? await loadHospitalAccess(u.id, hospital.id)
    : { roles: [], permissions: new Set(), staff: null, patientLink: null };

  return {
    sessionId: session.id,
    user: { id: u.id, email: u.email, name: u.name, mustChangePassword: u.mustChangePassword },
    platformRole: u.platformRole ?? null,
    isPlatformAdmin: u.platformRole === PLATFORM_ADMIN,
    hospitalId: hospital?.id ?? null,
    hospital,
    hospitals,
    roles: access.roles,
    permissions: access.permissions,
    staff: access.staff
      ? { id: access.staff.id, departmentId: access.staff.departmentId, departmentName: access.staff.department?.name ?? null, position: access.staff.position }
      : null,
    doctorId: access.staff?.doctorProfile?.id ?? null,
    patientId: access.patientLink?.verifiedAt ? access.patientLink.patientId : null,
    isPatient: access.roles.includes("PATIENT") && access.roles.length === 1,
  };
});

export function can(session, permission) {
  if (!session) return false;
  if (Array.isArray(permission)) return permission.some((p) => session.permissions.has(p));
  return session.permissions.has(permission);
}

/** Where a signed-in user without a usable hospital context should go. */
function noHospitalDestination(session) {
  return session.isPlatformAdmin ? "/platform" : "/forbidden";
}

/** For server components/pages: redirect to login if signed out, to /forbidden if lacking permission. */
export async function requirePageSession(permission, { allowPasswordChange = false } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.isPatient) redirect("/portal");
  if (!session.hospitalId) redirect(noHospitalDestination(session));
  // Accounts issued with a temporary password must set their own before using any module.
  if (permission && session.user.mustChangePassword && !allowPasswordChange) redirect("/account?first=1");
  if (permission && !can(session, permission)) redirect("/forbidden");
  return session;
}

export async function requirePortalSession({ allowPasswordChange = false } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.hospitalId || !can(session, "portal:access") || !session.patientId) redirect("/forbidden");
  if (session.user.mustChangePassword && !allowPasswordChange) redirect("/portal/profile?first=1");
  return session;
}

/** Platform console pages: Platform Administrators only. */
export async function requirePlatformSession({ allowPasswordChange = false } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isPlatformAdmin) redirect("/forbidden");
  if (session.user.mustChangePassword && !allowPasswordChange) redirect("/platform/account?first=1");
  return session;
}
