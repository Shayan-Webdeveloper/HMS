import { route } from "@/lib/api/handler";
import { rejectSpecimenSchema } from "@/lib/validation/lab";
import { rejectSpecimen } from "@/lib/services/lab";

export const POST = route({ permission: "lab:process" }, async ({ params, body, session, ip }) => {
  const input = await body(rejectSpecimenSchema);
  return rejectSpecimen(params.id, input, session, ip);
});
