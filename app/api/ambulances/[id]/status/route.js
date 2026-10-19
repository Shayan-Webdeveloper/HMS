import { route } from "@/lib/api/handler";
import { ambulanceStatusSchema } from "@/lib/validation/emergency";
import { setAmbulanceStatus } from "@/lib/services/ambulances";

export const POST = route({ permission: "ambulance:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(ambulanceStatusSchema);
  return setAmbulanceStatus(params.id, input, session, ip);
});
