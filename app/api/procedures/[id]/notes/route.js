import { route } from "@/lib/api/handler";
import { procedureNotesSchema } from "@/lib/validation/procedures";
import { updateProcedureNotes } from "@/lib/services/procedures";

export const POST = route({ permission: "procedures:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(procedureNotesSchema);
  return updateProcedureNotes(params.id, input, session, ip);
});
