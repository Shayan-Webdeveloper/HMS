import { route } from "@/lib/api/handler";
import { transferSchema } from "@/lib/validation/inpatient";
import { transferPatient } from "@/lib/services/admissions";

export const POST = route({ permission: "admissions:transfer" }, async ({ params, body, session, ip }) => {
  const input = await body(transferSchema);
  return transferPatient(params.id, input, session, ip);
});
