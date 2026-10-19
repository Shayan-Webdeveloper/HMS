import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { forgotSchema } from "@/lib/validation/auth";
import { rateLimit } from "@/lib/auth/rate-limit";
import { randomToken, sha256 } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/email";
import { audit } from "@/lib/audit";

// Always returns the same response, so the endpoint cannot be used to discover accounts.
export const POST = route({ public: true }, async ({ body, ip }) => {
  const { email } = await body(forgotSchema);
  await rateLimit(`forgot:ip:${ip || "unknown"}`, { limit: 10, windowSeconds: 3600 });
  await rateLimit(`forgot:email:${email}`, { limit: 3, windowSeconds: 3600 });
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.isActive) {
    const token = randomToken(32);
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
    const link = `${process.env.APP_URL || "http://localhost:3000"}/reset-password?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: "Password reset request",
      text: `A password reset was requested for your account.\n\nReset link (valid for 60 minutes):\n${link}\n\nIf you did not request this, you can ignore this email.`,
    });
    await audit({ userId: user.id, action: "auth.reset_requested", entityType: "User", entityId: user.id, ipAddress: ip });
  }
  return { message: "If an account exists for that email, a reset link has been sent." };
});
