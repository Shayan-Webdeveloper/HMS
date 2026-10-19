import { route } from "@/lib/api/handler";
import { getPermissionMatrix } from "@/lib/services/users";

export const GET = route({ permission: "users:manage" }, async ({ session }) => {
  const m = await getPermissionMatrix();
  return { ...m, canEdit: session.roles.includes("SUPER_ADMIN") };
});
