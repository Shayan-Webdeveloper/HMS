import { route, ok } from "@/lib/api/handler";
import { staffListQuery, staffSchema } from "@/lib/validation/staff";
import { listStaff, createStaff, isHrPrivileged } from "@/lib/services/staff";

export const GET = route({ permission: ["staff:read", "hr:read"] }, async ({ query, session }) => {
  const q = query(staffListQuery);
  const { rows, meta } = await listStaff({ ...q, sort: q.sort || "name", dir: q.sort ? q.dir : "asc" }, { privileged: isHrPrivileged(session) });
  return ok(rows, meta);
});

export const POST = route({ permission: "staff:manage" }, async ({ body, session, ip }) => {
  const input = await body(staffSchema);
  const r = await createStaff(input, session, ip);
  return ok(r, undefined, { status: 201 });
});
