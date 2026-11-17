import { route, ok } from "@/lib/api/handler";
import { listHospitals, createHospital, hospitalCreateSchema } from "@/lib/services/platform";

// Platform Administrator only. No hospital context: hospital data is unreachable from these routes.
export const GET = route({ platform: true }, async () => listHospitals());

export const POST = route({ platform: true }, async ({ body, session, ip }) => {
  const input = await body(hospitalCreateSchema);
  return ok(await createHospital(input, session, ip), undefined, { status: 201 });
});
