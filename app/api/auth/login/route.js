import { route } from "@/lib/api/handler";
import { systemPrisma } from "@/lib/db/prisma";
import { loginSchema } from "@/lib/validation/auth";
import { verifyPassword, dummyHash } from "@/lib/auth/password";
import { createSession, activeMemberships, loadHospitalAccess } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { isDemoAccountBlocked } from "@/lib/env";

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

// Sign-in happens before any hospital context exists, so it uses the system client with explicit
// filters. The session starts in the user's first active hospital (switchable later only among
// verified memberships); Platform Administrators start without a hospital, in the platform console.
export const POST = route({ public: true }, async ({ body, ip }) => {
  const { email, password } = await body(loginSchema);
  await rateLimit(`login:ip:${ip || "unknown"}`, { limit: 30, windowSeconds: 900 });
  await rateLimit(`login:email:${email}`, { limit: 10, windowSeconds: 900 });

  const invalid = new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
  const user = await systemPrisma.user.findUnique({ where: { email } });
  if (!user) { await verifyPassword(password, await dummyHash()); throw invalid; }
  if (isDemoAccountBlocked(user.email)) {
    await verifyPassword(password, await dummyHash());
    throw invalid; // demo accounts never work in production unless explicitly allowed
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(423, "LOCKED", "Too many failed attempts. The account is temporarily locked — try again later or reset your password.");
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const count = user.failedLoginCount + 1;
    await systemPrisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: count, lockedUntil: count >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
    });
    await audit({ userId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id, ipAddress: ip, hospitalId: null });
    throw invalid;
  }
  if (!user.isActive) throw new ApiError(403, "DEACTIVATED", "This account has been deactivated. Contact an administrator.");

  const isPlatformAdmin = user.platformRole === "PLATFORM_ADMIN";
  const hospitals = await activeMemberships(user.id);
  if (!hospitals.length && !isPlatformAdmin) {
    throw new ApiError(403, "NO_HOSPITAL_ACCESS", "Your account does not currently have access to any active hospital. Contact an administrator.");
  }
  const hospital = isPlatformAdmin ? null : hospitals[0];

  await systemPrisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id, hospital?.id ?? null);
  await audit({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ipAddress: ip, hospitalId: hospital?.id ?? null });

  let redirect = "/platform";
  if (hospital) {
    const access = await loadHospitalAccess(user.id, hospital.id);
    redirect = access.roles.length === 1 && access.roles[0] === "PATIENT" ? "/portal" : "/dashboard";
  }
  if (user.mustChangePassword && redirect === "/dashboard") redirect = "/account?first=1";
  if (user.mustChangePassword && redirect === "/portal") redirect = "/portal/profile?first=1";
  return { redirect, mustChangePassword: user.mustChangePassword };
});
