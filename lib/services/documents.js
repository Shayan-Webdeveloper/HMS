import "server-only";
import { prisma, currentHospitalId } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { putFile, getFile, removeFile, sniffType, safeFilename, MAX_BYTES, ALLOWED_TYPES } from "@/lib/storage";
import { badRequest, forbidden, notFound, invalidState } from "@/lib/errors";
import { DOCUMENT_CATEGORIES } from "@/lib/permissions/matrix";
import { staffCanReadCategory, staffCanUploadCategory, readableCategories, uploadableCategories, patientCanRead } from "@/lib/permissions/documents";

// Patient document authorization — one place for every rule, used by upload, download, listings and
// the patient portal:
//
//   Hospital  Documents are hospital-owned rows read through the hospital-scoped client (+ RLS), and
//             their storage keys are prefixed with the hospital id. Another hospital's document is
//             indistinguishable from a missing one (404).
//   Category  Staff need the category's own permission (documents.<group>:read / :upload). General
//             patient access (patients:read, clinical:read) grants NO document access by itself.
//   Patient   Portal users only ever see documents of their own verified patient record, and imaging
//             attachments only once the study's report is verified (same rule as the imaging report).
//
// The pure decision rules live in lib/permissions/documents.js (unit-tested).

export { DOCUMENT_CATEGORIES };
export { staffCanReadCategory, staffCanUploadCategory, readableCategories, uploadableCategories, patientCanRead };

async function imagingVerified(doc) {
  if (doc.ownerType !== "IMAGING") return false;
  const s = await prisma.imagingStudy.findUnique({ where: { id: doc.ownerId }, select: { status: true, patientId: true } });
  return !!s && s.status === "VERIFIED" && s.patientId === doc.patientId;
}

/** Validate an uploaded File object; returns { buf, mime }. */
export async function readUpload(file) {
  if (!file || typeof file === "string") throw badRequest("Choose a file to upload.");
  if (file.size > MAX_BYTES) throw badRequest(`File is too large (max ${(MAX_BYTES / 1048576).toFixed(0)} MB).`);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) throw badRequest("The file is empty.");
  if (buf.length > MAX_BYTES) throw badRequest(`File is too large (max ${(MAX_BYTES / 1048576).toFixed(0)} MB).`);
  // Content must match an allowed type regardless of the declared MIME type or extension.
  const mime = sniffType(buf);
  if (!mime || !ALLOWED_TYPES[mime]) throw badRequest("Only PDF, PNG and JPEG files are accepted.");
  return { buf, mime };
}

/**
 * Store a patient document. Authorisation: the category's upload permission, and the patient must
 * belong to the current hospital (hospital-scoped lookup) and not be merged into another record.
 */
export async function uploadDocument({ file, patientId, category, ownerType = "PATIENT", ownerId }, session, ip, { auditAction = "document.upload", auditEntity } = {}) {
  if (!DOCUMENT_CATEGORIES.includes(category)) throw badRequest("Invalid document category.");
  if (!staffCanUploadCategory(session, category)) throw forbidden("You do not have permission to upload this type of document.");
  const patient = await prisma.patient.findUnique({ where: { id: String(patientId || "") }, select: { id: true, status: true } });
  if (!patient) throw notFound("Patient not found");
  if (patient.status === "MERGED") throw invalidState("Documents cannot be added to a merged patient record.");
  const { buf, mime } = await readUpload(file);
  const hospitalId = await currentHospitalId();
  const { key, sha256 } = await putFile(buf, mime, { hospitalId });
  try {
    return await prisma.$transaction(async (tx) => {
      const doc = await tx.uploadedDocument.create({
        data: { patientId: patient.id, ownerType, ownerId: ownerId ?? patient.id, category, originalName: safeFilename(file.name), storageKey: key, mimeType: mime, sizeBytes: buf.length, sha256, uploadedById: session.user.id },
        select: { id: true, originalName: true, category: true, mimeType: true, sizeBytes: true, createdAt: true },
      });
      await audit({ userId: session.user.id, action: auditAction, entityType: auditEntity?.type ?? "Patient", entityId: auditEntity?.id ?? patient.id, metadata: { documentId: doc.id, category, mimeType: mime, sizeBytes: buf.length }, ipAddress: ip }, tx);
      return doc;
    });
  } catch (e) {
    await removeFile(key, { hospitalId }).catch(() => {});
    throw e;
  }
}

/**
 * Load a document for download, enforcing hospital, category and patient rules.
 * Anything not permitted is reported as "not found" so existence is never revealed.
 */
export async function getDocumentForDownload(id, session, ip) {
  const doc = await prisma.uploadedDocument.findUnique({ where: { id: String(id || "") } });
  if (!doc) throw notFound();
  // Patient accounts hold only the PATIENT role (staff roles cannot be combined with it).
  const allowed = session.isPatient
    ? patientCanRead(session, doc, { imagingVerified: await imagingVerified(doc) })
    : staffCanReadCategory(session, doc.category);
  if (!allowed) {
    await audit({ userId: session.user.id, action: "document.download_denied", entityType: "UploadedDocument", entityId: doc.id, metadata: { category: doc.category }, ipAddress: ip });
    throw notFound();
  }
  const buf = await getFile(doc.storageKey, { hospitalId: doc.hospitalId });
  await audit({ userId: session.user.id, action: "document.download", entityType: "UploadedDocument", entityId: doc.id, metadata: { category: doc.category }, ipAddress: ip });
  return { doc, buf };
}

const LIST_SELECT = { id: true, originalName: true, category: true, mimeType: true, sizeBytes: true, createdAt: true, ownerType: true, ownerId: true, uploadedById: true };

/** Staff listing for a patient: only categories the session may read (names can be sensitive too). */
export async function listPatientDocuments(patientId, session) {
  const categories = readableCategories(session);
  if (!categories.length) return [];
  return prisma.uploadedDocument.findMany({ where: { patientId, category: { in: categories } }, orderBy: { createdAt: "desc" }, take: 500, select: LIST_SELECT });
}

/** Portal listing: the patient's own documents that patientCanRead() allows. */
export async function listPortalDocuments(session) {
  if (!session?.patientId) return [];
  const docs = await prisma.uploadedDocument.findMany({ where: { patientId: session.patientId }, orderBy: { createdAt: "desc" }, take: 200, select: { ...LIST_SELECT, patientId: true } });
  const imagingIds = docs.filter((d) => d.ownerType === "IMAGING").map((d) => d.ownerId);
  const verified = new Set(imagingIds.length
    ? (await prisma.imagingStudy.findMany({ where: { id: { in: imagingIds }, patientId: session.patientId, status: "VERIFIED" }, select: { id: true } })).map((s) => s.id)
    : []);
  return docs
    .filter((d) => patientCanRead(session, d, { imagingVerified: verified.has(d.ownerId) }))
    .map(({ id, originalName, category, mimeType, sizeBytes, createdAt }) => ({ id, originalName, category, mimeType, sizeBytes, createdAt }));
}
