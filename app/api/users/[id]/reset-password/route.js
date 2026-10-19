import { route, ok } from "@/lib/api/handler";
import { adminResetPassword } from "@/lib/services/users";

// Issues a new temporary password (shown once), forces a change at next sign-in and revokes all sessions.
export const POST = route({ permission: "users:manage" }, async ({ params, session, ip }) => {
  const r = await adminResetPassword(params.id, session, ip);
  return ok(r, undefined, { headers: { "Cache-Control": "no-store" } });
});
