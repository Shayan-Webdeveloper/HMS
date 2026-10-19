import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { can } from "@/lib/auth/session";
import { departmentSchema } from "@/lib/validation/staff";
import { listDepartmentOptions, createDepartment } from "@/lib/services/departments";

const query = z.object({
  all: z.enum(["0", "1"]).optional().catch(undefined),
  clinical: z.enum(["0", "1"]).optional().catch(undefined),
});

// Contract (CONVENTIONS.md): [{ id, name, code, isClinical }] — active departments only by default.
// Department names are reference data needed by most modules, so any staff role may read them.
export const GET = route({ permission: ["staff:read", "hr:read", "dashboard:read"] }, async ({ query: q, session }) => {
  const p = q(query);
  const rows = await listDepartmentOptions({ includeInactive: p.all === "1" && can(session, "staff:read"), clinicalOnly: p.clinical === "1" });
  return rows;
});

export const POST = route({ permission: "staff:manage" }, async ({ body, session, ip }) => {
  const input = await body(departmentSchema);
  const d = await createDepartment(input, session, ip);
  return ok(d, undefined, { status: 201 });
});
