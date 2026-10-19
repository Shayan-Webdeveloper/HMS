import { route } from "@/lib/api/handler";
import { activeToggleSchema } from "@/lib/validation/inventory";
import { setItemActive } from "@/lib/services/inventory";

export const POST = route({ permission: "inventory:manage" }, async ({ params, body, session, ip }) => {
  const { isActive, reason } = await body(activeToggleSchema);
  return setItemActive(params.id, isActive, reason, session, ip);
});
