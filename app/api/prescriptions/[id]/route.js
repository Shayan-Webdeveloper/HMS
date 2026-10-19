import { route } from "@/lib/api/handler";
import { prescriptionUpdateSchema } from "@/lib/validation/prescriptions";
import { getPrescription, updatePrescription } from "@/lib/services/prescriptions";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "prescriptions:read" }, async ({ params }) => {
  const rx = await getPrescription(params.id);
  if (!rx) throw notFound();
  return rx;
});

export const PATCH = route({ permission: "prescriptions:create" }, async ({ params, body, session, ip }) => {
  const input = await body(prescriptionUpdateSchema);
  return updatePrescription(params.id, input, session, ip);
});
