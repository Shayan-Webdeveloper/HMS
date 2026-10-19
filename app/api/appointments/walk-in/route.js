import { route, ok } from "@/lib/api/handler";
import { walkInSchema } from "@/lib/validation/appointments";
import { createWalkIn } from "@/lib/services/appointments";

// Walk-ins bypass availability windows by design (see createWalkIn); they are checked in immediately with a queue token.
export const POST = route({ permission: "appointments:create" }, async ({ body, session, ip }) => {
  const input = await body(walkInSchema);
  const appt = await createWalkIn(input, session, ip);
  return ok(appt, undefined, { status: 201 });
});
