-- Part 2 — Dedicated, category-based document permissions.
--
-- Before: any staff member with patients:read (or clinical:read) could download EVERY patient
-- document, and any of five unrelated permissions allowed uploading a document of any category.
-- After: each document category maps to a permission group (lib/permissions/matrix.js →
-- DOCUMENT_CATEGORY_GROUPS) with separate :read and :upload permissions.
--
-- This migration adds the permission catalogue entries and grants the default role assignments in
-- EVERY existing hospital, so the change is deliberate and visible: e.g. reception keeps identity /
-- consent / insurance documents but loses access to clinical, lab and imaging documents; pharmacists
-- and HR lose document access entirely. Administrators can adjust grants per hospital in Settings → Roles.
-- Roles that do not exist yet (fresh install) are simply skipped; the seed / hospital creation
-- applies the same defaults from lib/permissions/matrix.js.

INSERT INTO "Permission" ("id", "key", "resource", "action", "description") VALUES
  (gen_random_uuid()::text, 'documents.clinical:read', 'documents.clinical', 'read', 'Download clinical documents (referrals, discharge summaries)'),
  (gen_random_uuid()::text, 'documents.clinical:upload', 'documents.clinical', 'upload', 'Upload clinical documents'),
  (gen_random_uuid()::text, 'documents.lab:read', 'documents.lab', 'read', 'Download laboratory report documents'),
  (gen_random_uuid()::text, 'documents.lab:upload', 'documents.lab', 'upload', 'Upload laboratory report documents'),
  (gen_random_uuid()::text, 'documents.imaging:read', 'documents.imaging', 'read', 'Download imaging report documents and attachments'),
  (gen_random_uuid()::text, 'documents.imaging:upload', 'documents.imaging', 'upload', 'Upload imaging report documents and attachments'),
  (gen_random_uuid()::text, 'documents.insurance:read', 'documents.insurance', 'read', 'Download insurance documents'),
  (gen_random_uuid()::text, 'documents.insurance:upload', 'documents.insurance', 'upload', 'Upload insurance documents'),
  (gen_random_uuid()::text, 'documents.identity:read', 'documents.identity', 'read', 'Download identity documents'),
  (gen_random_uuid()::text, 'documents.identity:upload', 'documents.identity', 'upload', 'Upload identity documents'),
  (gen_random_uuid()::text, 'documents.consent:read', 'documents.consent', 'read', 'Download consent forms'),
  (gen_random_uuid()::text, 'documents.consent:upload', 'documents.consent', 'upload', 'Upload consent forms'),
  (gen_random_uuid()::text, 'documents.other:read', 'documents.other', 'read', 'Download other patient documents'),
  (gen_random_uuid()::text, 'documents.other:upload', 'documents.other', 'upload', 'Upload other patient documents')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("hospitalId", "roleId", "permissionId")
SELECT h."id", r."id", p."id"
FROM (VALUES
  ('SUPER_ADMIN', 'documents.clinical:read'),
  ('SUPER_ADMIN', 'documents.clinical:upload'),
  ('SUPER_ADMIN', 'documents.lab:read'),
  ('SUPER_ADMIN', 'documents.lab:upload'),
  ('SUPER_ADMIN', 'documents.imaging:read'),
  ('SUPER_ADMIN', 'documents.imaging:upload'),
  ('SUPER_ADMIN', 'documents.insurance:read'),
  ('SUPER_ADMIN', 'documents.insurance:upload'),
  ('SUPER_ADMIN', 'documents.identity:read'),
  ('SUPER_ADMIN', 'documents.identity:upload'),
  ('SUPER_ADMIN', 'documents.consent:read'),
  ('SUPER_ADMIN', 'documents.consent:upload'),
  ('SUPER_ADMIN', 'documents.other:read'),
  ('SUPER_ADMIN', 'documents.other:upload'),
  ('HOSPITAL_ADMIN', 'documents.identity:read'),
  ('HOSPITAL_ADMIN', 'documents.identity:upload'),
  ('HOSPITAL_ADMIN', 'documents.consent:read'),
  ('HOSPITAL_ADMIN', 'documents.consent:upload'),
  ('HOSPITAL_ADMIN', 'documents.insurance:read'),
  ('HOSPITAL_ADMIN', 'documents.insurance:upload'),
  ('HOSPITAL_ADMIN', 'documents.other:read'),
  ('HOSPITAL_ADMIN', 'documents.other:upload'),
  ('RECEPTIONIST', 'documents.identity:read'),
  ('RECEPTIONIST', 'documents.identity:upload'),
  ('RECEPTIONIST', 'documents.consent:read'),
  ('RECEPTIONIST', 'documents.consent:upload'),
  ('RECEPTIONIST', 'documents.insurance:read'),
  ('RECEPTIONIST', 'documents.insurance:upload'),
  ('RECEPTIONIST', 'documents.other:upload'),
  ('RECEPTIONIST', 'documents.clinical:upload'),
  ('DOCTOR', 'documents.clinical:read'),
  ('DOCTOR', 'documents.clinical:upload'),
  ('DOCTOR', 'documents.lab:read'),
  ('DOCTOR', 'documents.imaging:read'),
  ('DOCTOR', 'documents.consent:read'),
  ('DOCTOR', 'documents.consent:upload'),
  ('DOCTOR', 'documents.other:read'),
  ('DOCTOR', 'documents.other:upload'),
  ('NURSE', 'documents.clinical:read'),
  ('NURSE', 'documents.lab:read'),
  ('NURSE', 'documents.imaging:read'),
  ('NURSE', 'documents.consent:read'),
  ('NURSE', 'documents.consent:upload'),
  ('NURSE', 'documents.other:read'),
  ('LAB_TECHNICIAN', 'documents.lab:read'),
  ('LAB_TECHNICIAN', 'documents.lab:upload'),
  ('RADIOLOGIST', 'documents.imaging:read'),
  ('RADIOLOGIST', 'documents.imaging:upload'),
  ('ACCOUNTANT', 'documents.insurance:read'),
  ('ACCOUNTANT', 'documents.insurance:upload')
) AS g(role_key, permission_key)
JOIN "Role" r ON r."key" = g.role_key
JOIN "Permission" p ON p."key" = g.permission_key
CROSS JOIN "Hospital" h
ON CONFLICT DO NOTHING;
