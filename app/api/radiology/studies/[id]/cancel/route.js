import { route } from "@/lib/api/handler";
import { imagingCancelSchema } from "@/lib/validation/radiology";
import { cancelStudy } from "@/lib/services/radiology";

// Radiology staff, or the requesting clinician (checked in the service).
export const POST = route({ permission: ["radiology:report", "radiology:verify", "radiology:order"] }, async ({ params, body, session, ip }) => {
  const input = await body(imagingCancelSchema);
  return cancelStudy(params.id, input, session, ip);
});
