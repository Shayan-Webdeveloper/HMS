import { route, ok } from "@/lib/api/handler";
import { auditQuerySchema } from "@/lib/validation/settings";
import { listAuditLogs } from "@/lib/services/users";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "audit:read" }, async ({ query }) => {
  const f = query(auditQuerySchema);
  const h = await getHospital();
  const { rows, meta } = await listAuditLogs(f, h.timezone);
  return ok(rows, meta);
});
