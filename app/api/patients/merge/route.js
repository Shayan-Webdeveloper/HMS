import { z } from "zod";
import { route } from "@/lib/api/handler";
import { mergePatients } from "@/lib/services/patients";

const schema = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1), reason: z.string().trim().min(5).max(300) });

export const POST = route({ permission: "patients:merge" }, async ({ body, session, ip }) => {
  const { sourceId, targetId, reason } = await body(schema);
  return mergePatients(sourceId, targetId, reason, session, ip);
});
