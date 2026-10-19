import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { randomToken, sha256 } from "./tokens";

// Server-side, database-backed sessions:
//  * The browser holds only an opaque random token in an HttpOnly, SameSite=Lax cookie.
//  * The database stores a SHA-256 of the token, so a DB leak does not leak live sessions.
//  * Deactivating a user or deleting their Session rows revokes access immediately.

export const SESSION_COOKIE = "hms_session";
const MAX_AGE_H = Number(process.env.SESSION_MAX_AGE_HOURS || 12);
const IDLE_MIN = Number(process.env.SESSION_IDLE_MINUTES || 60);

export async function createSession(userId) {
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + MAX_AGE_H * 3600 * 1000);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
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
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export function clientIp(h) {
  const xff = h.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : h.get("x-real-ip")) || null;
}

/**
 * Returns { user, roles, permissions:Set, staff, patientId, sessionId } or null.
 * Cached per request.
 */
export const getSession = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          staff: { include: { doctorProfile: true, department: true } },
          patientLink: true,
        },
      },
    },
  });
  if (!session) return null;
  const now = Date.now();
  const idleExpired = now - session.lastSeenAt.getTime() > IDLE_MIN * 60 * 1000;
  if (session.expiresAt.getTime() < now || idleExpired || !session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Throttle last-seen writes to once a minute.
  if (now - session.lastSeenAt.getTime() > 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const u = session.user;
  const roles = u.roles.map((r) => r.role.key);
  const permissions = new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)));
  return {
    sessionId: session.id,
    user: { id: u.id, email: u.email, name: u.name, mustChangePassword: u.mustChangePassword },
    roles,
    permissions,
    staff: u.staff
      ? { id: u.staff.id, departmentId: u.staff.departmentId, departmentName: u.staff.department?.name ?? null, position: u.staff.position }
      : null,
    doctorId: u.staff?.doctorProfile?.id ?? null,
    patientId: u.patientLink?.verifiedAt ? u.patientLink.patientId : null,
    isPatient: roles.includes("PATIENT") && roles.length === 1,
  };
});

export function can(session, permission) {
  if (!session) return false;
  if (Array.isArray(permission)) return permission.some((p) => session.permissions.has(p));
  return session.permissions.has(permission);
}

/** For server components/pages: redirect to login if signed out, to /forbidden if lacking permission. */
export async function requirePageSession(permission, { allowPasswordChange = false } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.isPatient) redirect("/portal");
  // Accounts issued with a temporary password must set their own before using any module.
  if (permission && session.user.mustChangePassword && !allowPasswordChange) redirect("/account?first=1");
  if (permission && !can(session, permission)) redirect("/forbidden");
  return session;
}

export async function requirePortalSession({ allowPasswordChange = false } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session, "portal:access") || !session.patientId) redirect("/forbidden");
  if (session.user.mustChangePassword && !allowPasswordChange) redirect("/portal/profile?first=1");
  return session;
}
