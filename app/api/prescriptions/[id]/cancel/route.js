import { route } from "@/lib/api/handler";
import { prescriptionCancelSchema } from "@/lib/validation/prescriptions";
import { cancelPrescription } from "@/lib/services/prescriptions";

export const POST = route({ permission: "prescriptions:cancel" }, async ({ params, body, session, ip }) => {
  const { reason } = await body(prescriptionCancelSchema);
  return cancelPrescription(params.id, reason, session, ip);
});
