-- Database-level guards that Prisma's schema language cannot express.
-- Prisma Migrate does not manage CHECK constraints, so these survive future `migrate dev` runs.

-- Stock can never go negative (pharmacy batches and general inventory).
ALTER TABLE "MedicationBatch" ADD CONSTRAINT "MedicationBatch_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_quantity_nonnegative" CHECK ("quantity" >= 0);

-- Prescription dispensing can never exceed the prescribed quantity.
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_dispensed_within_quantity" CHECK ("dispensedQty" >= 0 AND "dispensedQty" <= "quantity");

-- Money sanity.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_totals_nonnegative" CHECK ("total" >= 0 AND "amountPaid" >= 0 AND "amountRefunded" >= 0 AND "amountRefunded" <= "amountPaid");

-- An occupied bed must point at an admission; an available bed must not.
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_occupancy_consistent" CHECK (("status" = 'OCCUPIED') = ("currentAdmissionId" IS NOT NULL));

-- Appointment intervals must be well-formed.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_interval_valid" CHECK ("endsAt" > "startsAt");
