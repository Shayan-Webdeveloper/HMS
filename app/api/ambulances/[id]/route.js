import { route } from "@/lib/api/handler";
import { ambulanceSchema } from "@/lib/validation/emergency";
import { updateAmbulance } from "@/lib/services/ambulances";

export const PATCH = route({ permission: "ambulance:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(ambulanceSchema);
  return updateAmbulance(params.id, input, session, ip);
});
