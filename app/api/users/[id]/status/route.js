import { route } from "@/lib/api/handler";
import { userStatusSchema } from "@/lib/validation/users";
import { setUserActive } from "@/lib/services/users";

// Deactivation deletes the user's Session rows in the same transaction (immediate sign-out).
export const POST = route({ permission: "users:manage" }, async ({ params, body, session, ip }) => {
  const { active, reason } = await body(userStatusSchema);
  return setUserActive(params.id, active, reason, session, ip);
});
