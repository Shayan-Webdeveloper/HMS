import { route, ok } from "@/lib/api/handler";
import { noteSchema } from "@/lib/validation/encounters";
import { addNote } from "@/lib/services/encounters";

export const POST = route({ permission: "encounters:create" }, async ({ params, body, session, ip }) => {
  const input = await body(noteSchema);
  const n = await addNote(params.id, input, session, ip);
  return ok(n, undefined, { status: 201 });
});
