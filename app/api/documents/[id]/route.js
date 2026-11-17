import { route } from "@/lib/api/handler";
import { getDocumentForDownload } from "@/lib/services/documents";
import { notFound } from "@/lib/errors";

// Authorised download for staff AND portal users. Rules (lib/services/documents.js): same hospital,
// the category's read permission for staff, own verified record for patients. Every refusal is a 404
// so the existence of other hospitals' or other patients' documents is never revealed.
export const GET = route({ public: true }, async ({ params, session, ip }) => {
  if (!session || !session.hospitalId) throw notFound();
  const { doc, buf } = await getDocumentForDownload(params.id, session, ip);
  return new Response(buf, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${doc.originalName.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
