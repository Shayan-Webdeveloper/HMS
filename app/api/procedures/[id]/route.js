import { route } from "@/lib/api/handler";
import { procedureSchema } from "@/lib/validation/procedures";
import { getProcedure, updateProcedure } from "@/lib/services/procedures";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "procedures:read" }, async ({ params }) => {
  const p = await getProcedure(params.id);
  if (!p) throw notFound();
  return p;
});

// Reschedule / edit a SCHEDULED procedure (same conflict checks as booking).
export const PATCH = route({ permission: "procedures:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(procedureSchema);
  return updateProcedure(params.id, input, session, ip);
});
