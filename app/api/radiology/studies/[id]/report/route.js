import { route } from "@/lib/api/handler";
import { imagingReportSchema } from "@/lib/validation/radiology";
import { saveReport } from "@/lib/services/radiology";

export const POST = route({ permission: "radiology:report" }, async ({ params, body, session, ip }) => {
  const input = await body(imagingReportSchema);
  return saveReport(params.id, input, session, ip);
});
