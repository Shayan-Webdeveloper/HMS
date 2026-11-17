-- Part 6 — Multi-hospital tenancy (schema + safe backfill of existing data).
--
-- Every hospital-owned table gets "hospitalId". Existing rows are assigned to the hospital they
-- belong to. Rules (no guessing, no silent reassignment):
--   * exactly one Hospital row  → every existing hospital-owned row belongs to it;
--   * zero Hospital rows        → allowed only if hospital-owned tables are empty (fresh install);
--   * more than one Hospital    → abort if any hospital-owned row exists; an administrator must
--                                 assign ownership explicitly (docs/MULTI_TENANCY.md).
-- Columns are added as NULLable, backfilled, and only then made NOT NULL. The new default reads the
-- transaction-local setting app.hospital_id, set by the server from the authenticated session.
-- Identifiers that were globally unique (MRN, invoice no., codes) become unique per hospital.
--
-- Rollback: restore the pre-migration backup (scripts/db/backup.mjs / restore.mjs). The reverse DDL
-- is mechanical (drop the added columns/tables, recreate the old unique indexes) but is only safe
-- while a single hospital exists, because per-hospital identifiers may otherwise collide.

-- 0. The hospital of the current transaction (set by the server from the authenticated session).
--    Used as the column default below and by the RLS policies (next migration).
CREATE SCHEMA IF NOT EXISTS hms_internal;
REVOKE ALL ON SCHEMA hms_internal FROM PUBLIC;
CREATE OR REPLACE FUNCTION hms_internal.current_hospital_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.hospital_id', true), '') $$;
REVOKE ALL ON FUNCTION hms_internal.current_hospital_id() FROM PUBLIC;

CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_ADMIN');
ALTER TABLE "Hospital" ADD COLUMN     "deactivatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN     "platformRole" "PlatformRole";
ALTER TABLE "Session" ADD COLUMN     "activeHospitalId" TEXT;
CREATE TABLE "HospitalMembership" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL DEFAULT hms_internal.current_hospital_id(),
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HospitalMembership_pkey" PRIMARY KEY ("id")
);

-- 1. New nullable columns
ALTER TABLE "RolePermission" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "UserRole" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Staff" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "DoctorProfile" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "DoctorAvailability" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "ScheduleException" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "EmployeeAttendance" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Patient" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "PatientUserLink" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "EmergencyContact" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Allergy" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "MedicalHistory" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "QueueEntry" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Encounter" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "ClinicalNote" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Diagnosis" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "VitalSign" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Ward" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Bed" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Admission" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "BedAssignment" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "NursingNote" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "EmergencyVisit" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Medication" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "MedicationBatch" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Prescription" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "PrescriptionItem" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "MedicationAdministration" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "LaboratoryTest" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "LabOrder" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "LabOrderItem" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Specimen" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "LabResult" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "ImagingStudy" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "ImagingReport" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "OperatingTheatre" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Procedure" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Refund" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "InsuranceProvider" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "InsurancePolicy" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "InsuranceClaim" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Ambulance" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "AmbulanceDispatch" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "UploadedDocument" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "hospitalId" TEXT;
ALTER TABLE "Sequence" ADD COLUMN "hospitalId" TEXT;

-- 2. Backfill
DO $$
DECLARE
  hospital_count int;
  the_hospital text;
  t text;
  has_rows boolean;
  tenant_tables text[] := ARRAY['RolePermission', 'UserRole', 'Staff', 'DoctorProfile', 'DoctorAvailability', 'ScheduleException', 'EmployeeAttendance', 'LeaveRequest', 'Patient', 'PatientUserLink', 'EmergencyContact', 'Allergy', 'MedicalHistory', 'Appointment', 'QueueEntry', 'Encounter', 'ClinicalNote', 'Diagnosis', 'VitalSign', 'Ward', 'Bed', 'Admission', 'BedAssignment', 'NursingNote', 'EmergencyVisit', 'Medication', 'MedicationBatch', 'Prescription', 'PrescriptionItem', 'MedicationAdministration', 'LaboratoryTest', 'LabOrder', 'LabOrderItem', 'Specimen', 'LabResult', 'ImagingStudy', 'ImagingReport', 'OperatingTheatre', 'Procedure', 'Invoice', 'InvoiceItem', 'Payment', 'Refund', 'InsuranceProvider', 'InsurancePolicy', 'InsuranceClaim', 'Supplier', 'InventoryItem', 'PurchaseOrder', 'PurchaseOrderItem', 'StockMovement', 'Ambulance', 'AmbulanceDispatch', 'Notification', 'UploadedDocument', 'AuditLog', 'Sequence'];
BEGIN
  SELECT count(*) INTO hospital_count FROM "Hospital";
  IF hospital_count = 1 THEN
    SELECT id INTO the_hospital FROM "Hospital";
    FOREACH t IN ARRAY tenant_tables LOOP
      EXECUTE format('UPDATE %I SET "hospitalId" = $1 WHERE "hospitalId" IS NULL', t) USING the_hospital;
    END LOOP;
    -- Every existing user with a hospital role becomes a member of that hospital.
    INSERT INTO "HospitalMembership" ("id", "hospitalId", "userId", "isActive", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, the_hospital, u."id", true, now(), now()
    FROM "User" u
    WHERE EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id");
  ELSE
    FOREACH t IN ARRAY tenant_tables LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO has_rows;
      IF has_rows THEN
        RAISE EXCEPTION 'Table "%" has rows but % hospitals exist: hospital ownership is ambiguous. Assign "hospitalId" manually first (docs/MULTI_TENANCY.md). Nothing was changed.', t, hospital_count;
      END IF;
    END LOOP;
  END IF;
END $$;

-- 3. Enforce NOT NULL and the session-derived default
ALTER TABLE "RolePermission" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "UserRole" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Staff" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "DoctorProfile" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "DoctorAvailability" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "ScheduleException" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "EmployeeAttendance" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "LeaveRequest" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Patient" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "PatientUserLink" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "EmergencyContact" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Allergy" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "MedicalHistory" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Appointment" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "QueueEntry" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Encounter" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "ClinicalNote" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Diagnosis" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "VitalSign" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Ward" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Bed" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Admission" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "BedAssignment" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "NursingNote" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "EmergencyVisit" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Medication" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "MedicationBatch" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Prescription" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "PrescriptionItem" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "MedicationAdministration" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "LaboratoryTest" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "LabOrder" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "LabOrderItem" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Specimen" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "LabResult" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "ImagingStudy" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "ImagingReport" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "OperatingTheatre" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Procedure" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Invoice" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "InvoiceItem" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Payment" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Refund" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "InsuranceProvider" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "InsurancePolicy" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "InsuranceClaim" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Supplier" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "InventoryItem" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "PurchaseOrder" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "StockMovement" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Ambulance" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "AmbulanceDispatch" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Notification" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "UploadedDocument" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Sequence" ALTER COLUMN "hospitalId" SET NOT NULL, ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
-- AuditLog.hospitalId stays NULLable: NULL marks platform-level events.
ALTER TABLE "AuditLog" ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();

-- 4. Per-hospital uniqueness, keys and tenant-leading indexes
DROP INDEX "Facility_code_key";
DROP INDEX "Department_code_key";
DROP INDEX "Staff_employeeNo_key";
DROP INDEX "Staff_userId_key";
DROP INDEX "Staff_lastName_firstName_idx";
DROP INDEX "DoctorProfile_licenseNumber_key";
DROP INDEX "Patient_mrn_key";
DROP INDEX "Patient_lastName_firstName_idx";
DROP INDEX "Patient_phone_idx";
DROP INDEX "Patient_status_registeredAt_idx";
DROP INDEX "PatientUserLink_userId_key";
DROP INDEX "Appointment_appointmentNo_key";
DROP INDEX "Appointment_status_startsAt_idx";
DROP INDEX "QueueEntry_queueDate_status_idx";
DROP INDEX "Encounter_encounterNo_key";
DROP INDEX "Ward_code_key";
DROP INDEX "Bed_status_idx";
DROP INDEX "Admission_admissionNo_key";
DROP INDEX "Admission_status_admittedAt_idx";
DROP INDEX "EmergencyVisit_visitNo_key";
DROP INDEX "EmergencyVisit_status_arrivedAt_idx";
DROP INDEX "Medication_code_key";
DROP INDEX "Medication_genericName_idx";
DROP INDEX "MedicationBatch_expiryDate_idx";
DROP INDEX "Prescription_prescriptionNo_key";
DROP INDEX "Prescription_status_createdAt_idx";
DROP INDEX "LaboratoryTest_code_key";
DROP INDEX "LabOrder_orderNo_key";
DROP INDEX "LabOrder_status_createdAt_idx";
DROP INDEX "Specimen_specimenNo_key";
DROP INDEX "ImagingStudy_studyNo_key";
DROP INDEX "ImagingStudy_status_createdAt_idx";
DROP INDEX "OperatingTheatre_name_key";
DROP INDEX "Procedure_procedureNo_key";
DROP INDEX "Invoice_invoiceNo_key";
DROP INDEX "Invoice_status_createdAt_idx";
DROP INDEX "InvoiceItem_sourceType_sourceId_idx";
DROP INDEX "Payment_receiptNo_key";
DROP INDEX "Payment_idempotencyKey_key";
DROP INDEX "Payment_receivedAt_idx";
DROP INDEX "InsuranceProvider_name_key";
DROP INDEX "InsuranceClaim_claimNo_key";
DROP INDEX "Supplier_name_key";
DROP INDEX "InventoryItem_code_key";
DROP INDEX "PurchaseOrder_poNumber_key";
DROP INDEX "Ambulance_vehicleNo_key";
DROP INDEX "UploadedDocument_ownerType_ownerId_idx";
DROP INDEX "AuditLog_entityType_entityId_idx";
ALTER TABLE "Facility" ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "Department" ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "SystemSetting" ALTER COLUMN "hospitalId" SET DEFAULT hms_internal.current_hospital_id();
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_pkey",
ADD CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("hospitalId", "roleId", "permissionId");
ALTER TABLE "UserRole" DROP CONSTRAINT "UserRole_pkey",
ADD CONSTRAINT "UserRole_pkey" PRIMARY KEY ("hospitalId", "userId", "roleId");
ALTER TABLE "Sequence" DROP CONSTRAINT "Sequence_pkey",
ADD CONSTRAINT "Sequence_pkey" PRIMARY KEY ("hospitalId", "key");
CREATE INDEX "HospitalMembership_userId_idx" ON "HospitalMembership"("userId");
CREATE UNIQUE INDEX "HospitalMembership_hospitalId_userId_key" ON "HospitalMembership"("hospitalId", "userId");
CREATE INDEX "Hospital_isActive_name_idx" ON "Hospital"("isActive", "name");
CREATE UNIQUE INDEX "Facility_hospitalId_code_key" ON "Facility"("hospitalId", "code");
CREATE UNIQUE INDEX "Department_hospitalId_code_key" ON "Department"("hospitalId", "code");
CREATE INDEX "Session_activeHospitalId_idx" ON "Session"("activeHospitalId");
CREATE INDEX "Staff_hospitalId_lastName_firstName_idx" ON "Staff"("hospitalId", "lastName", "firstName");
CREATE UNIQUE INDEX "Staff_hospitalId_employeeNo_key" ON "Staff"("hospitalId", "employeeNo");
CREATE UNIQUE INDEX "Staff_hospitalId_userId_key" ON "Staff"("hospitalId", "userId");
CREATE UNIQUE INDEX "DoctorProfile_hospitalId_licenseNumber_key" ON "DoctorProfile"("hospitalId", "licenseNumber");
CREATE INDEX "DoctorAvailability_hospitalId_idx" ON "DoctorAvailability"("hospitalId");
CREATE INDEX "ScheduleException_hospitalId_idx" ON "ScheduleException"("hospitalId");
CREATE INDEX "EmployeeAttendance_hospitalId_date_idx" ON "EmployeeAttendance"("hospitalId", "date");
CREATE INDEX "LeaveRequest_hospitalId_status_idx" ON "LeaveRequest"("hospitalId", "status");
CREATE INDEX "Patient_hospitalId_lastName_firstName_idx" ON "Patient"("hospitalId", "lastName", "firstName");
CREATE INDEX "Patient_hospitalId_phone_idx" ON "Patient"("hospitalId", "phone");
CREATE INDEX "Patient_hospitalId_status_registeredAt_idx" ON "Patient"("hospitalId", "status", "registeredAt");
CREATE UNIQUE INDEX "Patient_hospitalId_mrn_key" ON "Patient"("hospitalId", "mrn");
CREATE UNIQUE INDEX "PatientUserLink_hospitalId_userId_key" ON "PatientUserLink"("hospitalId", "userId");
CREATE INDEX "EmergencyContact_hospitalId_idx" ON "EmergencyContact"("hospitalId");
CREATE INDEX "Allergy_hospitalId_idx" ON "Allergy"("hospitalId");
CREATE INDEX "MedicalHistory_hospitalId_idx" ON "MedicalHistory"("hospitalId");
CREATE INDEX "Appointment_hospitalId_status_startsAt_idx" ON "Appointment"("hospitalId", "status", "startsAt");
CREATE INDEX "Appointment_hospitalId_startsAt_idx" ON "Appointment"("hospitalId", "startsAt");
CREATE UNIQUE INDEX "Appointment_hospitalId_appointmentNo_key" ON "Appointment"("hospitalId", "appointmentNo");
CREATE INDEX "QueueEntry_hospitalId_queueDate_status_idx" ON "QueueEntry"("hospitalId", "queueDate", "status");
CREATE INDEX "Encounter_hospitalId_startedAt_idx" ON "Encounter"("hospitalId", "startedAt");
CREATE UNIQUE INDEX "Encounter_hospitalId_encounterNo_key" ON "Encounter"("hospitalId", "encounterNo");
CREATE INDEX "ClinicalNote_hospitalId_idx" ON "ClinicalNote"("hospitalId");
CREATE INDEX "Diagnosis_hospitalId_idx" ON "Diagnosis"("hospitalId");
CREATE INDEX "VitalSign_hospitalId_idx" ON "VitalSign"("hospitalId");
CREATE UNIQUE INDEX "Ward_hospitalId_code_key" ON "Ward"("hospitalId", "code");
CREATE INDEX "Bed_hospitalId_status_idx" ON "Bed"("hospitalId", "status");
CREATE INDEX "Admission_hospitalId_status_admittedAt_idx" ON "Admission"("hospitalId", "status", "admittedAt");
CREATE UNIQUE INDEX "Admission_hospitalId_admissionNo_key" ON "Admission"("hospitalId", "admissionNo");
CREATE INDEX "BedAssignment_hospitalId_idx" ON "BedAssignment"("hospitalId");
CREATE INDEX "NursingNote_hospitalId_idx" ON "NursingNote"("hospitalId");
CREATE INDEX "EmergencyVisit_hospitalId_status_arrivedAt_idx" ON "EmergencyVisit"("hospitalId", "status", "arrivedAt");
CREATE UNIQUE INDEX "EmergencyVisit_hospitalId_visitNo_key" ON "EmergencyVisit"("hospitalId", "visitNo");
CREATE INDEX "Medication_hospitalId_genericName_idx" ON "Medication"("hospitalId", "genericName");
CREATE UNIQUE INDEX "Medication_hospitalId_code_key" ON "Medication"("hospitalId", "code");
CREATE INDEX "MedicationBatch_hospitalId_expiryDate_idx" ON "MedicationBatch"("hospitalId", "expiryDate");
CREATE INDEX "Prescription_hospitalId_status_createdAt_idx" ON "Prescription"("hospitalId", "status", "createdAt");
CREATE UNIQUE INDEX "Prescription_hospitalId_prescriptionNo_key" ON "Prescription"("hospitalId", "prescriptionNo");
CREATE INDEX "PrescriptionItem_hospitalId_idx" ON "PrescriptionItem"("hospitalId");
CREATE INDEX "MedicationAdministration_hospitalId_idx" ON "MedicationAdministration"("hospitalId");
CREATE UNIQUE INDEX "LaboratoryTest_hospitalId_code_key" ON "LaboratoryTest"("hospitalId", "code");
CREATE INDEX "LabOrder_hospitalId_status_createdAt_idx" ON "LabOrder"("hospitalId", "status", "createdAt");
CREATE UNIQUE INDEX "LabOrder_hospitalId_orderNo_key" ON "LabOrder"("hospitalId", "orderNo");
CREATE INDEX "LabOrderItem_hospitalId_idx" ON "LabOrderItem"("hospitalId");
CREATE UNIQUE INDEX "Specimen_hospitalId_specimenNo_key" ON "Specimen"("hospitalId", "specimenNo");
CREATE INDEX "LabResult_hospitalId_idx" ON "LabResult"("hospitalId");
CREATE INDEX "ImagingStudy_hospitalId_status_createdAt_idx" ON "ImagingStudy"("hospitalId", "status", "createdAt");
CREATE UNIQUE INDEX "ImagingStudy_hospitalId_studyNo_key" ON "ImagingStudy"("hospitalId", "studyNo");
CREATE INDEX "ImagingReport_hospitalId_idx" ON "ImagingReport"("hospitalId");
CREATE UNIQUE INDEX "OperatingTheatre_hospitalId_name_key" ON "OperatingTheatre"("hospitalId", "name");
CREATE INDEX "Procedure_hospitalId_scheduledStart_idx" ON "Procedure"("hospitalId", "scheduledStart");
CREATE UNIQUE INDEX "Procedure_hospitalId_procedureNo_key" ON "Procedure"("hospitalId", "procedureNo");
CREATE INDEX "Invoice_hospitalId_status_createdAt_idx" ON "Invoice"("hospitalId", "status", "createdAt");
CREATE UNIQUE INDEX "Invoice_hospitalId_invoiceNo_key" ON "Invoice"("hospitalId", "invoiceNo");
CREATE INDEX "InvoiceItem_hospitalId_sourceType_sourceId_idx" ON "InvoiceItem"("hospitalId", "sourceType", "sourceId");
CREATE INDEX "Payment_hospitalId_receivedAt_idx" ON "Payment"("hospitalId", "receivedAt");
CREATE UNIQUE INDEX "Payment_hospitalId_receiptNo_key" ON "Payment"("hospitalId", "receiptNo");
CREATE UNIQUE INDEX "Payment_hospitalId_idempotencyKey_key" ON "Payment"("hospitalId", "idempotencyKey");
CREATE INDEX "Refund_hospitalId_createdAt_idx" ON "Refund"("hospitalId", "createdAt");
CREATE UNIQUE INDEX "InsuranceProvider_hospitalId_name_key" ON "InsuranceProvider"("hospitalId", "name");
CREATE INDEX "InsurancePolicy_hospitalId_idx" ON "InsurancePolicy"("hospitalId");
CREATE INDEX "InsuranceClaim_hospitalId_status_idx" ON "InsuranceClaim"("hospitalId", "status");
CREATE UNIQUE INDEX "InsuranceClaim_hospitalId_claimNo_key" ON "InsuranceClaim"("hospitalId", "claimNo");
CREATE UNIQUE INDEX "Supplier_hospitalId_name_key" ON "Supplier"("hospitalId", "name");
CREATE UNIQUE INDEX "InventoryItem_hospitalId_code_key" ON "InventoryItem"("hospitalId", "code");
CREATE INDEX "PurchaseOrder_hospitalId_status_idx" ON "PurchaseOrder"("hospitalId", "status");
CREATE UNIQUE INDEX "PurchaseOrder_hospitalId_poNumber_key" ON "PurchaseOrder"("hospitalId", "poNumber");
CREATE INDEX "PurchaseOrderItem_hospitalId_idx" ON "PurchaseOrderItem"("hospitalId");
CREATE INDEX "StockMovement_hospitalId_createdAt_idx" ON "StockMovement"("hospitalId", "createdAt");
CREATE UNIQUE INDEX "Ambulance_hospitalId_vehicleNo_key" ON "Ambulance"("hospitalId", "vehicleNo");
CREATE INDEX "AmbulanceDispatch_hospitalId_dispatchedAt_idx" ON "AmbulanceDispatch"("hospitalId", "dispatchedAt");
CREATE INDEX "Notification_hospitalId_createdAt_idx" ON "Notification"("hospitalId", "createdAt");
CREATE INDEX "UploadedDocument_hospitalId_ownerType_ownerId_idx" ON "UploadedDocument"("hospitalId", "ownerType", "ownerId");
CREATE INDEX "AuditLog_hospitalId_entityType_entityId_idx" ON "AuditLog"("hospitalId", "entityType", "entityId");
CREATE INDEX "AuditLog_hospitalId_createdAt_idx" ON "AuditLog"("hospitalId", "createdAt");

-- 5. Foreign keys
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeHospitalId_fkey" FOREIGN KEY ("activeHospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalMembership" ADD CONSTRAINT "HospitalMembership_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalMembership" ADD CONSTRAINT "HospitalMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DoctorAvailability" ADD CONSTRAINT "DoctorAvailability_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeAttendance" ADD CONSTRAINT "EmployeeAttendance_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientUserLink" ADD CONSTRAINT "PatientUserLink_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicalHistory" ADD CONSTRAINT "MedicalHistory_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NursingNote" ADD CONSTRAINT "NursingNote_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyVisit" ADD CONSTRAINT "EmergencyVisit_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationBatch" ADD CONSTRAINT "MedicationBatch_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaboratoryTest" ADD CONSTRAINT "LaboratoryTest_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingTheatre" ADD CONSTRAINT "OperatingTheatre_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsuranceProvider" ADD CONSTRAINT "InsuranceProvider_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ambulance" ADD CONSTRAINT "Ambulance_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AmbulanceDispatch" ADD CONSTRAINT "AmbulanceDispatch_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UploadedDocument" ADD CONSTRAINT "UploadedDocument_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
