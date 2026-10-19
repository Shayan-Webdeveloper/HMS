import { route } from "@/lib/api/handler";
import { destroySession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const POST = route({ public: true }, async ({ session, ip }) => {
  if (session) await audit({ userId: session.user.id, action: "auth.logout", entityType: "User", entityId: session.user.id, ipAddress: ip });
  await destroySession();
  return { signedOut: true };
});
