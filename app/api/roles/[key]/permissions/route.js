import { route } from "@/lib/api/handler";
import { rolePermissionsSchema } from "@/lib/validation/users";
import { setRolePermissions } from "@/lib/services/users";

// Replace a role's permission set. Only SUPER_ADMIN (checked in the service against session.roles).
export const PUT = route({ permission: "users:manage" }, async ({ params, body, session, ip }) => {
  const { permissions } = await body(rolePermissionsSchema);
  return setRolePermissions(params.key, permissions, session, ip);
});
