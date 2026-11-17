import { route, ok } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
import { addImagingAttachment, listImagingAttachments } from "@/lib/services/radiology";
import { staffCanReadCategory } from "@/lib/services/documents";

// Files are downloaded through the existing authorised GET /api/documents/[id].
export const GET = route({ permission: "radiology:read" }, async ({ params, session }) => {
  const s = await prisma.imagingStudy.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!s) throw notFound("Imaging study not found");
  // Attachment names are only listed to users who may download imaging documents.
  if (!staffCanReadCategory(session, "IMAGING_REPORT")) return [];
  const docs = await listImagingAttachments(params.id);
  return docs.map((d) => ({ ...d, href: `/api/documents/${d.id}` }));
});

// Requires a radiology workflow permission here AND documents.imaging:upload (checked in the service).
export const POST = route({ permission: ["radiology:report", "radiology:verify"] }, async ({ req, params, session, ip }) => {
  let form;
  try { form = await req.formData(); } catch { form = null; }
  const file = form?.get("file");
  const doc = await addImagingAttachment(params.id, file, session, ip);
  return ok({ ...doc, href: `/api/documents/${doc.id}` }, undefined, { status: 201 });
});
