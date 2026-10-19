import { route } from "@/lib/api/handler";
import { theatreUpdateSchema } from "@/lib/validation/procedures";
import { updateTheatre } from "@/lib/services/procedures";

export const PATCH = route({ permission: "procedures:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(theatreUpdateSchema);
  return updateTheatre(params.id, input, session, ip);
});
