-- Part 4 — Referential integrity for actor / reference columns.
--
-- Columns such as createdById, recordedById, authorId, finalizedById … stored user ids without a
-- foreign key, so a typo or a deleted user could leave dangling references. This migration:
--   1. aborts (changing nothing) if ANY existing value does not match a real row, listing every
--      offending column, so invalid data can be reviewed and fixed by a person — never silently
--      deleted or nulled;
--   2. adds the foreign keys with ON DELETE RESTRICT (users and clinical rows are never hard-deleted,
--      so attribution can never be lost) and ON UPDATE CASCADE;
--   3. adds a supporting index for every foreign-key column that lacked one (Supabase performance
--      advisor: "unindexed foreign keys"), plus NursingNote → Admission and Procedure → DoctorProfile.

DO $$
DECLARE
  chk record;
  n bigint;
  problems text := '';
BEGIN
  FOR chk IN SELECT * FROM (VALUES
    ('SystemSetting', 'updatedById', 'User'),
    ('LeaveRequest', 'decidedById', 'User'),
    ('Patient', 'mergedIntoId', 'Patient'),
    ('Patient', 'createdById', 'User'),
    ('Allergy', 'recordedById', 'User'),
    ('MedicalHistory', 'recordedById', 'User'),
    ('Appointment', 'createdById', 'User'),
    ('Encounter', 'finalizedById', 'User'),
    ('ClinicalNote', 'authorId', 'User'),
    ('VitalSign', 'recordedById', 'User'),
    ('Admission', 'createdById', 'User'),
    ('BedAssignment', 'assignedById', 'User'),
    ('NursingNote', 'admissionId', 'Admission'),
    ('NursingNote', 'authorId', 'User'),
    ('EmergencyVisit', 'triagedById', 'User'),
    ('EmergencyVisit', 'assignedClinicianId', 'User'),
    ('MedicationAdministration', 'administeredById', 'User'),
    ('LabOrder', 'releasedById', 'User'),
    ('Specimen', 'collectedById', 'User'),
    ('LabResult', 'enteredById', 'User'),
    ('LabResult', 'validatedById', 'User'),
    ('ImagingStudy', 'requestedById', 'User'),
    ('ImagingReport', 'reportedById', 'User'),
    ('ImagingReport', 'verifiedById', 'User'),
    ('Procedure', 'surgeonId', 'DoctorProfile'),
    ('Invoice', 'createdById', 'User'),
    ('Payment', 'receivedById', 'User'),
    ('Refund', 'approvedById', 'User'),
    ('PurchaseOrder', 'createdById', 'User'),
    ('StockMovement', 'performedById', 'User'),
    ('AmbulanceDispatch', 'createdById', 'User'),
    ('UploadedDocument', 'uploadedById', 'User')
  ) AS v(tbl, col, parent) LOOP
    EXECUTE format('SELECT count(*) FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I)',
                   chk.tbl, chk.col, chk.parent, chk.col) INTO n;
    IF n > 0 THEN
      problems := problems || format(E'
  %s.%s → %s: %s orphaned row(s)', chk.tbl, chk.col, chk.parent, n);
    END IF;
  END LOOP;
  IF problems <> '' THEN
    RAISE EXCEPTION 'Orphaned references found; nothing was changed. Fix or review these rows, then re-run the migration:%', problems;
  END IF;
END $$;

CREATE INDEX "SystemSetting_updatedById_idx" ON "SystemSetting"("updatedById");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "Staff_userId_idx" ON "Staff"("userId");
CREATE INDEX "LeaveRequest_decidedById_idx" ON "LeaveRequest"("decidedById");
CREATE INDEX "Patient_mergedIntoId_idx" ON "Patient"("mergedIntoId");
CREATE INDEX "Patient_createdById_idx" ON "Patient"("createdById");
CREATE INDEX "PatientUserLink_userId_idx" ON "PatientUserLink"("userId");
CREATE INDEX "EmergencyContact_patientId_idx" ON "EmergencyContact"("patientId");
CREATE INDEX "Allergy_recordedById_idx" ON "Allergy"("recordedById");
CREATE INDEX "MedicalHistory_recordedById_idx" ON "MedicalHistory"("recordedById");
CREATE INDEX "Appointment_departmentId_idx" ON "Appointment"("departmentId");
CREATE INDEX "Appointment_createdById_idx" ON "Appointment"("createdById");
CREATE INDEX "Encounter_departmentId_idx" ON "Encounter"("departmentId");
CREATE INDEX "Encounter_admissionId_idx" ON "Encounter"("admissionId");
CREATE INDEX "Encounter_finalizedById_idx" ON "Encounter"("finalizedById");
CREATE INDEX "ClinicalNote_authorId_idx" ON "ClinicalNote"("authorId");
CREATE INDEX "VitalSign_encounterId_idx" ON "VitalSign"("encounterId");
CREATE INDEX "VitalSign_admissionId_idx" ON "VitalSign"("admissionId");
CREATE INDEX "VitalSign_recordedById_idx" ON "VitalSign"("recordedById");
CREATE INDEX "Ward_facilityId_idx" ON "Ward"("facilityId");
CREATE INDEX "Ward_departmentId_idx" ON "Ward"("departmentId");
CREATE INDEX "Admission_doctorId_idx" ON "Admission"("doctorId");
CREATE INDEX "Admission_createdById_idx" ON "Admission"("createdById");
CREATE INDEX "BedAssignment_assignedById_idx" ON "BedAssignment"("assignedById");
CREATE INDEX "NursingNote_authorId_idx" ON "NursingNote"("authorId");
CREATE INDEX "EmergencyVisit_patientId_idx" ON "EmergencyVisit"("patientId");
CREATE INDEX "EmergencyVisit_triagedById_idx" ON "EmergencyVisit"("triagedById");
CREATE INDEX "EmergencyVisit_assignedClinicianId_idx" ON "EmergencyVisit"("assignedClinicianId");
CREATE INDEX "MedicationBatch_supplierId_idx" ON "MedicationBatch"("supplierId");
CREATE INDEX "Prescription_doctorId_idx" ON "Prescription"("doctorId");
CREATE INDEX "Prescription_encounterId_idx" ON "Prescription"("encounterId");
CREATE INDEX "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");
CREATE INDEX "PrescriptionItem_medicationId_idx" ON "PrescriptionItem"("medicationId");
CREATE INDEX "MedicationAdministration_admissionId_idx" ON "MedicationAdministration"("admissionId");
CREATE INDEX "MedicationAdministration_prescriptionItemId_idx" ON "MedicationAdministration"("prescriptionItemId");
CREATE INDEX "MedicationAdministration_administeredById_idx" ON "MedicationAdministration"("administeredById");
CREATE INDEX "LabOrder_doctorId_idx" ON "LabOrder"("doctorId");
CREATE INDEX "LabOrder_encounterId_idx" ON "LabOrder"("encounterId");
CREATE INDEX "LabOrder_releasedById_idx" ON "LabOrder"("releasedById");
CREATE INDEX "LabOrderItem_orderId_idx" ON "LabOrderItem"("orderId");
CREATE INDEX "LabOrderItem_testId_idx" ON "LabOrderItem"("testId");
CREATE INDEX "Specimen_orderId_idx" ON "Specimen"("orderId");
CREATE INDEX "Specimen_collectedById_idx" ON "Specimen"("collectedById");
CREATE INDEX "LabResult_enteredById_idx" ON "LabResult"("enteredById");
CREATE INDEX "LabResult_validatedById_idx" ON "LabResult"("validatedById");
CREATE INDEX "ImagingStudy_patientId_idx" ON "ImagingStudy"("patientId");
CREATE INDEX "ImagingStudy_encounterId_idx" ON "ImagingStudy"("encounterId");
CREATE INDEX "ImagingStudy_requestedById_idx" ON "ImagingStudy"("requestedById");
CREATE INDEX "ImagingReport_reportedById_idx" ON "ImagingReport"("reportedById");
CREATE INDEX "ImagingReport_verifiedById_idx" ON "ImagingReport"("verifiedById");
CREATE INDEX "Procedure_surgeonId_scheduledStart_idx" ON "Procedure"("surgeonId", "scheduledStart");
CREATE INDEX "Procedure_patientId_idx" ON "Procedure"("patientId");
CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX "InvoiceItem_encounterId_idx" ON "InvoiceItem"("encounterId");
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");
CREATE INDEX "Payment_receivedById_idx" ON "Payment"("receivedById");
CREATE INDEX "Refund_invoiceId_idx" ON "Refund"("invoiceId");
CREATE INDEX "Refund_approvedById_idx" ON "Refund"("approvedById");
CREATE INDEX "InsurancePolicy_patientId_idx" ON "InsurancePolicy"("patientId");
CREATE INDEX "InsuranceClaim_policyId_idx" ON "InsuranceClaim"("policyId");
CREATE INDEX "InsuranceClaim_invoiceId_idx" ON "InsuranceClaim"("invoiceId");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX "PurchaseOrder_createdById_idx" ON "PurchaseOrder"("createdById");
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX "PurchaseOrderItem_inventoryItemId_idx" ON "PurchaseOrderItem"("inventoryItemId");
CREATE INDEX "StockMovement_batchId_idx" ON "StockMovement"("batchId");
CREATE INDEX "StockMovement_performedById_idx" ON "StockMovement"("performedById");
CREATE INDEX "AmbulanceDispatch_ambulanceId_idx" ON "AmbulanceDispatch"("ambulanceId");
CREATE INDEX "AmbulanceDispatch_emergencyVisitId_idx" ON "AmbulanceDispatch"("emergencyVisitId");
CREATE INDEX "AmbulanceDispatch_createdById_idx" ON "AmbulanceDispatch"("createdById");
CREATE INDEX "UploadedDocument_patientId_idx" ON "UploadedDocument"("patientId");
CREATE INDEX "UploadedDocument_uploadedById_idx" ON "UploadedDocument"("uploadedById");
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicalHistory" ADD CONSTRAINT "MedicalHistory_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VitalSign" ADD CONSTRAINT "VitalSign_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BedAssignment" ADD CONSTRAINT "BedAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NursingNote" ADD CONSTRAINT "NursingNote_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NursingNote" ADD CONSTRAINT "NursingNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyVisit" ADD CONSTRAINT "EmergencyVisit_triagedById_fkey" FOREIGN KEY ("triagedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyVisit" ADD CONSTRAINT "EmergencyVisit_assignedClinicianId_fkey" FOREIGN KEY ("assignedClinicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_administeredById_fkey" FOREIGN KEY ("administeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingReport" ADD CONSTRAINT "ImagingReport_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_surgeonId_fkey" FOREIGN KEY ("surgeonId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AmbulanceDispatch" ADD CONSTRAINT "AmbulanceDispatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UploadedDocument" ADD CONSTRAINT "UploadedDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
