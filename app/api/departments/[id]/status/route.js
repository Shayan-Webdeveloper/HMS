import { route } from "@/lib/api/handler";
import { departmentStatusSchema } from "@/lib/validation/staff";
import { setDepartmentActive } from "@/lib/services/departments";

export const POST = route({ permission: "staff:manage" }, async ({ params, body, session, ip }) => {
  const { isActive, reason } = await body(departmentStatusSchema);
  return setDepartmentActive(params.id, isActive, reason, session, ip);
});
