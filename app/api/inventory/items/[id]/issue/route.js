import { route } from "@/lib/api/handler";
import { issueSchema } from "@/lib/validation/inventory";
import { issueItem } from "@/lib/services/inventory";

// Body: { departmentId, quantity, note? } — ISSUE movement, conditional decrement.
export const POST = route({ permission: "inventory:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(issueSchema);
  return issueItem(params.id, input, session, ip);
});
