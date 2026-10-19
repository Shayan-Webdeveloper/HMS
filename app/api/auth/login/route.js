import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { loginSchema } from "@/lib/validation/auth";
import { verifyPassword, dummyHash } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export const POST = route({ public: true }, async ({ body, ip }) => {
  const { email, password } = await body(loginSchema);
  await rateLimit(`login:ip:${ip || "unknown"}`, { limit: 30, windowSeconds: 900 });
  await rateLimit(`login:email:${email}`, { limit: 10, windowSeconds: 900 });

  const invalid = new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
  const user = await prisma.user.findUnique({ where: { email }, include: { roles: { include: { role: true } } } });
  if (!user) { await verifyPassword(password, await dummyHash()); throw invalid; }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(423, "LOCKED", "Too many failed attempts. The account is temporarily locked — try again later or reset your password.");
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const count = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: count, lockedUntil: count >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
    });
    await audit({ userId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id, ipAddress: ip });
    throw invalid;
  }
  if (!user.isActive) throw new ApiError(403, "DEACTIVATED", "This account has been deactivated. Contact an administrator.");

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id);
  await audit({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ipAddress: ip });
  const isPatient = user.roles.length === 1 && user.roles[0].role.key === "PATIENT";
  return { redirect: isPatient ? "/portal" : "/dashboard", mustChangePassword: user.mustChangePassword };
});
