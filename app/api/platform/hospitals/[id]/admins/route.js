import { route, ok } from "@/lib/api/handler";
import { addHospitalAdmin, memberSchema } from "@/lib/services/platform";

// Appoint a hospital administrator. The temporary password (new accounts only) is shown once.
export const POST = route({ platform: true }, async ({ params, body, session, ip }) => {
  const r = await addHospitalAdmin(params.id, await body(memberSchema), session, ip);
  return ok(r, undefined, { status: 201 });
});
