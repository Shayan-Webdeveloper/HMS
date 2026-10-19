import { route } from "@/lib/api/handler";
import { scheduleSchema } from "@/lib/validation/radiology";
import { scheduleStudy } from "@/lib/services/radiology";
import { getHospital } from "@/lib/services/settings";

// date + time are wall-clock values in the hospital time zone.
export const POST = route({ permission: "radiology:report" }, async ({ params, body, session, ip }) => {
  const input = await body(scheduleSchema);
  const h = await getHospital();
  return scheduleStudy(params.id, input, session, ip, h.timezone);
});
