import { route } from "@/lib/api/handler";
import { staffSchema } from "@/lib/validation/staff";
import { getStaff, updateStaff, redactStaff, isHrPrivileged } from "@/lib/services/staff";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: ["staff:read", "hr:read"] }, async ({ params, session }) => {
  const s = await getStaff(params.id);
  if (!s) throw notFound();
  return redactStaff(s, isHrPrivileged(session));
});

export const PATCH = route({ permission: "staff:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(staffSchema);
  return updateStaff(params.id, input, session, ip);
});
