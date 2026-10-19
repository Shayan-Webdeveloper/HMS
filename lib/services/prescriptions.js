import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { ApiError, conflict, forbidden, invalidState, notFound } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { ALLERGY_CHECK_LABEL, matchAllergies } from "@/lib/validation/prescriptions";
import { notifyPermission } from "@/lib/services/notifications";
import { isSuperAdmin } from "@/lib/services/appointments";

export const PRESCRIPTION_INCLUDE = {
  items: { include: { medication: { select: { id: true, code: true, genericName: true, brandName: true, strength: true, dosageForm: true, category: true } } } },
  patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
  doctor: { select: { id: true, staff: { select: { firstName: true, lastName: true } } } },
  encounter: { select: { id: true, encounterNo: true, status: true } },
};

export async function listPrescriptions({ patientId, encounterId, status, q, page = 1, pageSize = 20 }) {
  const where = {};
  if (patientId) where.patientId = patientId;
  if (encounterId) where.encounterId = encounterId;
  if (status) where.status = status;
  if (q) where.prescriptionNo = { contains: q, mode: "insensitive" };
  const [total, rows] = await Promise.all([
    prisma.prescription.count({ where }),
    prisma.prescription.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: PRESCRIPTION_INCLUDE }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export function getPrescription(id) {
  return prisma.prescription.findUnique({ where: { id }, include: PRESCRIPTION_INCLUDE });
}

async function loadMedications(db, items) {
  const ids = items.map((i) => i.medicationId);
  const meds = await db.medication.findMany({ where: { id: { in: ids } }, select: { id: true, genericName: true, brandName: true, category: true, isActive: true } });
  const byId = Object.fromEntries(meds.map((m) => [m.id, m]));
  const missing = ids.filter((id) => !byId[id] || !byId[id].isActive);
  if (missing.length) throw new ApiError(422, "VALIDATION_ERROR", "One or more medicines are not in the active formulary.", { items: "Choose medicines from the pharmacy catalogue" });
  return meds;
}

/**
 * Basic allergy name match. If anything matches and the prescriber has not acknowledged,
 * the request is refused with 409 ALLERGY_WARNING and the matches, so the UI can ask for
 * explicit acknowledgement. This is NOT a clinical decision-support or interaction check.
 */
async function allergyGate(db, patientId, meds, acknowledged) {
  const allergies = await db.allergy.findMany({ where: { patientId, isActive: true }, select: { id: true, substance: true, severity: true, reaction: true } });
  const matches = matchAllergies(allergies, meds);
  if (matches.length && !acknowledged) {
    throw new ApiError(409, "ALLERGY_WARNING", `Possible allergy match. ${ALLERGY_CHECK_LABEL}. Review and acknowledge to continue.`, { allergyWarnings: matches, label: ALLERGY_CHECK_LABEL });
  }
  return matches;
}

const itemData = (i) => ({ medicationId: i.medicationId, dose: i.dose, route: i.route, frequency: i.frequency, durationDays: i.durationDays, quantity: i.quantity, instructions: i.instructions ?? null });

async function notifyPharmacy(rx) {
  try {
    await notifyPermission(["pharmacy:dispense"], { category: "PHARMACY", title: "New prescription ready for dispensing", body: rx.prescriptionNo, link: `/pharmacy/prescriptions/${rx.id}` });
  } catch (e) {
    console.error("[prescriptions] pharmacy notification failed:", e?.code || e?.name || "error");
  }
}

/**
 * Create a prescription.
 *  - Linked to a DRAFT encounter → saved as DRAFT; it becomes ACTIVE when the encounter is finalized
 *    (`finalize` is ignored for encounter-linked prescriptions).
 *  - Standalone → ACTIVE with issuedAt when `finalize` is true, otherwise DRAFT.
 */
export async function createPrescription(input, session, ip, now = new Date()) {
  let doctorId = session.doctorId;
  let encounter = null;
  if (input.encounterId) {
    encounter = await prisma.encounter.findUnique({ where: { id: input.encounterId }, select: { id: true, patientId: true, doctorId: true, status: true } });
    if (!encounter || encounter.patientId !== input.patientId) throw notFound("Consultation not found for this patient");
    if (encounter.status !== "DRAFT") throw invalidState("This consultation is finalized. Prescriptions can only be added while it is a draft.");
    if (!((session.doctorId && session.doctorId === encounter.doctorId) || isSuperAdmin(session))) throw forbidden("Only the treating doctor can prescribe in this consultation.");
    doctorId = encounter.doctorId;
  }
  if (!doctorId) throw forbidden("A doctor profile is required to prescribe.");
  const patient = await prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, status: true } });
  if (!patient || patient.status === "MERGED") throw notFound("Patient not found");
  if (patient.status !== "ACTIVE") throw invalidState("Prescriptions can only be written for active patients.");

  const issueNow = !encounter && input.finalize;
  const rx = await prisma.$transaction(async (tx) => {
    if (encounter) {
      const rows = await tx.$queryRaw`SELECT status::text AS status FROM "Encounter" WHERE id = ${encounter.id} FOR UPDATE`;
      if (rows[0]?.status !== "DRAFT") throw conflict("The consultation was finalized meanwhile. Reload to continue.");
    }
    const meds = await loadMedications(tx, input.items);
    const matches = await allergyGate(tx, input.patientId, meds, input.acknowledgeAllergies);
    const created = await tx.prescription.create({
      data: {
        prescriptionNo: await newId(tx, "prescription"), patientId: input.patientId, doctorId, encounterId: encounter?.id ?? null,
        status: issueNow ? "ACTIVE" : "DRAFT", issuedAt: issueNow ? now : null, notes: input.notes ?? null,
        items: { create: input.items.map(itemData) },
      },
      include: PRESCRIPTION_INCLUDE,
    });
    await audit({
      userId: session.user.id, action: "prescription.create", entityType: "Prescription", entityId: created.id,
      metadata: { prescriptionNo: created.prescriptionNo, encounterId: created.encounterId, status: created.status, itemCount: input.items.length, ...(matches.length ? { allergyWarningAcknowledged: true, matchedAllergyIds: [...new Set(matches.map((m) => m.allergyId))] } : {}) },
      ipAddress: ip,
    }, tx);
    return created;
  });
  if (rx.status === "ACTIVE") await notifyPharmacy(rx);
  return rx;
}

/** Edit a DRAFT prescription (prescriber or SUPER_ADMIN). `finalize` issues standalone drafts. */
export async function updatePrescription(id, input, session, ip, now = new Date()) {
  const rx = await prisma.prescription.findUnique({ where: { id }, include: { encounter: { select: { id: true, status: true } } } });
  if (!rx) throw notFound();
  if (rx.status !== "DRAFT") throw invalidState("Only draft prescriptions can be edited.");
  if (!((session.doctorId && session.doctorId === rx.doctorId) || isSuperAdmin(session))) throw forbidden("Only the prescriber can edit this prescription.");
  if (input.finalize && rx.encounterId) throw invalidState("Prescriptions in a consultation are issued automatically when the consultation is finalized.");
  const updated = await prisma.$transaction(async (tx) => {
    if (rx.encounterId) {
      const rows = await tx.$queryRaw`SELECT status::text AS status FROM "Encounter" WHERE id = ${rx.encounterId} FOR UPDATE`;
      if (rows[0]?.status !== "DRAFT") throw conflict("The consultation was finalized meanwhile. Reload to continue.");
    }
    let matches = [];
    if (input.items) {
      const meds = await loadMedications(tx, input.items);
      matches = await allergyGate(tx, rx.patientId, meds, input.acknowledgeAllergies);
    }
    const data = {};
    if ("notes" in input) data.notes = input.notes ?? null;
    if (input.finalize) { data.status = "ACTIVE"; data.issuedAt = now; }
    const r = await tx.prescription.updateMany({ where: { id, status: "DRAFT" }, data });
    if (r.count === 0) throw conflict("The prescription was changed by someone else. Reload and try again.");
    if (input.items) {
      // Draft items have never been dispensed, so replacing them is safe.
      await tx.prescriptionItem.deleteMany({ where: { prescriptionId: id } });
      await tx.prescriptionItem.createMany({ data: input.items.map((i) => ({ ...itemData(i), prescriptionId: id })) });
    }
    await audit({
      userId: session.user.id, action: input.finalize ? "prescription.issue" : "prescription.update", entityType: "Prescription", entityId: id,
      metadata: { fields: [...Object.keys(data), ...(input.items ? ["items"] : [])], ...(matches.length ? { allergyWarningAcknowledged: true, matchedAllergyIds: [...new Set(matches.map((m) => m.allergyId))] } : {}) },
      ipAddress: ip,
    }, tx);
    return tx.prescription.findUnique({ where: { id }, include: PRESCRIPTION_INCLUDE });
  });
  if (updated.status === "ACTIVE") await notifyPharmacy(updated);
  return updated;
}

/** Cancel (with reason) only while nothing has been dispensed. Race-safe against concurrent dispensing. */
export async function cancelPrescription(id, reason, session, ip) {
  const rx = await prisma.prescription.findUnique({ where: { id }, include: { items: { select: { dispensedQty: true } } } });
  if (!rx) throw notFound();
  if (!["DRAFT", "ACTIVE"].includes(rx.status)) throw invalidState(`A ${rx.status.replace(/_/g, " ").toLowerCase()} prescription can't be cancelled.`);
  if (rx.items.some((i) => i.dispensedQty > 0)) throw invalidState("Part of this prescription has already been dispensed, so it can't be cancelled.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.prescription.updateMany({
      where: { id, status: { in: ["DRAFT", "ACTIVE"] }, items: { none: { dispensedQty: { gt: 0 } } } },
      data: { status: "CANCELLED", cancelReason: reason },
    });
    if (r.count === 0) throw conflict("The prescription was dispensed or changed meanwhile. Reload to see its current status.");
    await audit({ userId: session.user.id, action: "prescription.cancel", entityType: "Prescription", entityId: id, metadata: { from: rx.status, reason }, ipAddress: ip }, tx);
    return tx.prescription.findUnique({ where: { id }, include: PRESCRIPTION_INCLUDE });
  });
}
