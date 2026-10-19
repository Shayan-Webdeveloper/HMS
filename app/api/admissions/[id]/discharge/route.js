import { route } from "@/lib/api/handler";
import { dischargeSchema } from "@/lib/validation/inpatient";
import { dischargePatient } from "@/lib/services/admissions";

export const POST = route({ permission: "admissions:discharge" }, async ({ params, body, session, ip }) => {
  const input = await body(dischargeSchema);
  return dischargePatient(params.id, input, session, ip);
});
