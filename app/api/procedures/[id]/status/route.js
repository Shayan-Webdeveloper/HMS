import { route } from "@/lib/api/handler";
import { procedureStatusSchema } from "@/lib/validation/procedures";
import { changeProcedureStatus } from "@/lib/services/procedures";

export const POST = route({ permission: "procedures:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(procedureStatusSchema);
  return changeProcedureStatus(params.id, input, session, ip);
});
