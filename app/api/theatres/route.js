import { route, ok } from "@/lib/api/handler";
import { theatreSchema } from "@/lib/validation/procedures";
import { listTheatres, createTheatre } from "@/lib/services/procedures";

export const GET = route({ permission: "procedures:read" }, async () => listTheatres());

export const POST = route({ permission: "procedures:manage" }, async ({ body, session, ip }) => {
  const input = await body(theatreSchema);
  return ok(await createTheatre(input, session, ip), undefined, { status: 201 });
});
