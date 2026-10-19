import { route, ok } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
import { addImagingAttachment, listImagingAttachments } from "@/lib/services/radiology";

// Files are downloaded through the existing authorised GET /api/documents/[id].
export const GET = route({ permission: "radiology:read" }, async ({ params }) => {
  const s = await prisma.imagingStudy.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!s) throw notFound("Imaging study not found");
  const docs = await listImagingAttachments(params.id);
  return docs.map((d) => ({ ...d, href: `/api/documents/${d.id}` }));
});

export const POST = route({ permission: ["radiology:report", "radiology:verify"] }, async ({ req, params, session, ip }) => {
  let form;
  try { form = await req.formData(); } catch { form = null; }
  const file = form?.get("file");
  const doc = await addImagingAttachment(params.id, file, session, ip);
  return ok({ ...doc, href: `/api/documents/${doc.id}` }, undefined, { status: 201 });
});
