import { route, ok } from "@/lib/api/handler";
import { leaveListQuery, leaveSchema } from "@/lib/validation/staff";
import { listLeave, createLeave } from "@/lib/services/hr";

export const GET = route({ permission: ["hr:read", "staff:manage"] }, async ({ query }) => {
  const q = query(leaveListQuery);
  const { rows, meta } = await listLeave(q);
  return ok(rows, meta);
});

// Any staff:manage or hr:manage user can file on behalf of a staff member.
export const POST = route({ permission: ["hr:manage", "staff:manage"] }, async ({ body, session, ip }) => {
  const input = await body(leaveSchema);
  const r = await createLeave(input, session, ip);
  return ok(r, undefined, { status: 201 });
});
