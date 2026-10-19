import { z } from "zod";
import { route } from "@/lib/api/handler";
import { callQueueEntry } from "@/lib/services/encounters";

const schema = z.object({ action: z.enum(["call"]) });

export const PATCH = route({ permission: "appointments:update" }, async ({ params, body, session, ip }) => {
  await body(schema);
  return callQueueEntry(params.id, session, ip);
});
