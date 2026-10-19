import { route } from "@/lib/api/handler";
import { statusChangeSchema } from "@/lib/validation/staff";
import { changeEmploymentStatus } from "@/lib/services/staff";

// SUSPENDED / TERMINATED immediately deactivate the linked login and delete its sessions.
export const POST = route({ permission: "staff:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(statusChangeSchema);
  return changeEmploymentStatus(params.id, input, session, ip);
});
