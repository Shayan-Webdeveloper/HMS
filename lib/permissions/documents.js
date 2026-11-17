// Pure document-authorisation rules (no database access) — unit-tested in tests/unit/tenancy.test.js
// and used by lib/services/documents.js for upload, download, listings and the patient portal.
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_GROUPS, documentPermission } from "./matrix.js";

const has = (session, perm) => !!session?.permissions?.has?.(perm);

/** May a STAFF session read a document of `category`? General patient access is NOT enough. */
export function staffCanReadCategory(session, category) {
  const perm = documentPermission(category, "read");
  return !!perm && !session?.isPatient && has(session, perm);
}

/** May a STAFF session upload a document of `category`? */
export function staffCanUploadCategory(session, category) {
  const perm = documentPermission(category, "upload");
  return !!perm && !session?.isPatient && has(session, perm);
}

export const readableCategories = (session) => DOCUMENT_CATEGORIES.filter((c) => staffCanReadCategory(session, c));
export const uploadableCategories = (session) => DOCUMENT_CATEGORIES.filter((c) => staffCanUploadCategory(session, c));

/**
 * May a PORTAL (patient) session read this document? Only documents of their own verified patient
 * record, and imaging attachments only once the study's report is verified.
 */
export function patientCanRead(session, doc, { imagingVerified = false } = {}) {
  if (!session?.patientId || !has(session, "portal:access")) return false;
  if (!doc || doc.patientId !== session.patientId) return false;
  if (!DOCUMENT_CATEGORY_GROUPS[doc.category]) return false;
  if (doc.ownerType === "IMAGING" && !imagingVerified) return false;
  return true;
}
