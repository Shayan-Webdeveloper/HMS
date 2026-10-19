import { route } from "@/lib/api/handler";
import { labTestActiveSchema } from "@/lib/validation/lab";
import { setLabTestActive } from "@/lib/services/lab";

export const POST = route({ permission: "lab:manage" }, async ({ params, body, session, ip }) => {
  const { isActive } = await body(labTestActiveSchema);
  return setLabTestActive(params.id, isActive, session, ip);
});
