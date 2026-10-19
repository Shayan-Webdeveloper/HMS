import { route, ok } from "@/lib/api/handler";
import { noteSchema } from "@/lib/validation/inpatient";
import { addAdmissionNote, listNotes } from "@/lib/services/admissions";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "clinical:read" }, async ({ params }) => {
  const a = await prisma.admission.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!a) throw notFound();
  return listNotes(params.id);
});

// Append-only: there is deliberately no PATCH/DELETE. Kind-specific permission checks live in the service.
export const POST = route({ permission: ["nursing:create", "encounters:create"] }, async ({ params, body, session, ip }) => {
  const input = await body(noteSchema);
  return ok(await addAdmissionNote(params.id, input, session, ip), undefined, { status: 201 });
});
