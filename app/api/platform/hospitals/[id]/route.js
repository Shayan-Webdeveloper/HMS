import { route } from "@/lib/api/handler";
import { setHospitalActive, hospitalStatusSchema } from "@/lib/services/platform";

export const PATCH = route({ platform: true }, async ({ params, body, session, ip }) =>
  setHospitalActive(params.id, await body(hospitalStatusSchema), session, ip));
