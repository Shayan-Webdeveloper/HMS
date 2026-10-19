import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { getFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/session";
import { notFound, forbidden } from "@/lib/errors";

// Authorised download. Staff need clinical/patient read access; patients may only fetch their own documents.
export const GET = route({ public: true }, async ({ params, session, ip }) => {
  if (!session) throw forbidden();
  const doc = await prisma.uploadedDocument.findUnique({ where: { id: params.id } });
  if (!doc) throw notFound();
  const staffOk = !session.isPatient && can(session, ["clinical:read", "patients:read"]);
  const patientOk = session.patientId && doc.patientId === session.patientId;
  if (!staffOk && !patientOk) throw notFound(); // do not reveal existence
  const buf = await getFile(doc.storageKey);
  await audit({ userId: session.user.id, action: "document.download", entityType: "UploadedDocument", entityId: doc.id, ipAddress: ip });
  return new Response(buf, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${doc.originalName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
