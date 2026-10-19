import { route } from "@/lib/api/handler";
import { departmentSchema } from "@/lib/validation/staff";
import { getDepartment, updateDepartment } from "@/lib/services/departments";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "staff:read" }, async ({ params }) => {
  const d = await getDepartment(params.id);
  if (!d) throw notFound();
  return d;
});

export const PATCH = route({ permission: "staff:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(departmentSchema);
  return updateDepartment(params.id, input, session, ip);
});
