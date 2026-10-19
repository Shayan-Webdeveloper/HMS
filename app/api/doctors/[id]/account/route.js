import { route, ok } from "@/lib/api/handler";
import { createDoctorAccount } from "@/lib/services/staff";

// Creates a DOCTOR login with a one-time temporary password (mustChangePassword=true).
// The password is returned once in this response and never stored or logged in plain text.
export const POST = route({ permission: "users:manage" }, async ({ params, session, ip }) => {
  const r = await createDoctorAccount(params.id, session, ip);
  return ok(r, undefined, { status: 201, headers: { "Cache-Control": "no-store" } });
});
