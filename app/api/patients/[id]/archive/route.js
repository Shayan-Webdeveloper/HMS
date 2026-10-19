import { z } from "zod";
import { route } from "@/lib/api/handler";
import { setPatientArchived } from "@/lib/services/patients";

const schema = z.object({ archived: z.boolean(), reason: z.string().trim().min(3, "Give a reason").max(300) });

export const POST = route({ permission: "patients:archive" }, async ({ params, body, session, ip }) => {
  const { archived, reason } = await body(schema);
  return setPatientArchived(params.id, archived, reason, session, ip);
});
