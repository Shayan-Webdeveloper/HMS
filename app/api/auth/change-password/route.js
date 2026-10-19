import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { changePasswordSchema } from "@/lib/validation/auth";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";

export const POST = route({ portal: false, public: true }, async ({ body, session, ip }) => {
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  const { currentPassword, newPassword } = await body(changePasswordSchema);
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new ApiError(422, "VALIDATION_ERROR", "Current password is incorrect.", { currentPassword: "Current password is incorrect." });
  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new ApiError(422, "VALIDATION_ERROR", weak, { newPassword: weak });
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } }),
    prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: session.sessionId } } }), // sign out other devices
  ]);
  await audit({ userId: user.id, action: "auth.password_changed", entityType: "User", entityId: user.id, ipAddress: ip });
  return { message: "Password changed. Other sessions have been signed out." };
});
