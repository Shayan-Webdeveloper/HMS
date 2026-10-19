import { route } from "@/lib/api/handler";
import { checklistSchema } from "@/lib/validation/procedures";
import { confirmChecklist } from "@/lib/services/procedures";

export const POST = route({ permission: "procedures:manage" }, async ({ params, body, session, ip }) => {
  await body(checklistSchema);
  return confirmChecklist(params.id, session, ip);
});
