import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { resetSchema } from "@/lib/validation/auth";
import { sha256 } from "@/lib/auth/tokens";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";

export const POST = route({ public: true }, async ({ body, ip }) => {
  const { token, password } = await body(resetSchema);
  await rateLimit(`reset:ip:${ip || "unknown"}`, { limit: 20, windowSeconds: 3600 });
  const weak = validatePasswordStrength(password);
  if (weak) throw new ApiError(422, "VALIDATION_ERROR", weak, { password: weak });
  const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new ApiError(400, "INVALID_TOKEN", "This reset link is invalid or has expired. Request a new one.");
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: rec.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null, mustChangePassword: false } }),
    prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: rec.userId } }), // revoke all existing sessions
  ]);
  await audit({ userId: rec.userId, action: "auth.password_reset", entityType: "User", entityId: rec.userId, ipAddress: ip });
  return { message: "Password updated. You can now sign in." };
});
