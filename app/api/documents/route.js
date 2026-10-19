import { route } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { putFile, sniffType, safeFilename, MAX_BYTES, ALLOWED_TYPES } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";

const CATEGORIES = ["REFERRAL", "LAB_REPORT", "IMAGING_REPORT", "DISCHARGE_SUMMARY", "INSURANCE", "ID_DOCUMENT", "CONSENT", "OTHER"];

export const POST = route({ permission: ["patients:update", "encounters:create", "lab:process", "radiology:report", "insurance:manage"] }, async ({ req, session, ip }) => {
  const form = await req.formData();
  const file = form.get("file");
  const patientId = String(form.get("patientId") || "");
  const category = String(form.get("category") || "OTHER");
  if (!file || typeof file === "string") throw badRequest("Choose a file to upload.");
  if (!CATEGORIES.includes(category)) throw badRequest("Invalid document category.");
  if (file.size > MAX_BYTES) throw badRequest(`File is too large (max ${(MAX_BYTES / 1048576).toFixed(0)} MB).`);
  const buf = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffType(buf);
  // Content must match an allowed type regardless of the declared MIME type or extension.
  if (!sniffed || !ALLOWED_TYPES[sniffed]) throw badRequest("Only PDF, PNG and JPEG files are accepted.");
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!patient) throw notFound("Patient not found");
  const { key, sha256 } = await putFile(buf, sniffed);
  const doc = await prisma.uploadedDocument.create({
    data: { patientId, ownerType: "PATIENT", ownerId: patientId, category, originalName: safeFilename(file.name), storageKey: key, mimeType: sniffed, sizeBytes: buf.length, sha256, uploadedById: session.user.id },
  });
  await audit({ userId: session.user.id, action: "document.upload", entityType: "Patient", entityId: patientId, metadata: { documentId: doc.id, category }, ipAddress: ip });
  return { id: doc.id, originalName: doc.originalName, category: doc.category, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt };
});
