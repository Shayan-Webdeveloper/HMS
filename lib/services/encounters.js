import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { conflict, forbidden, invalidState, notFound } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { SOAP_FIELDS } from "@/lib/validation/encounters";
import { APPOINTMENT_ACTIONS } from "@/lib/validation/appointments";
import { patientSearchWhere } from "@/lib/services/patients";
import { getHospital } from "@/lib/services/settings";
import { notifyPermission } from "@/lib/services/notifications";
import { isSuperAdmin } from "@/lib/services/appointments";
import { dayRangeUtc, todayInTz } from "@/lib/utils/time";

// ───────────────────────────── Guards ─────────────────────────────

/** True when the session is the encounter's treating doctor (or SUPER_ADMIN). */
export function isEncounterAuthor(enc, session) {
  return (!!session.doctorId && session.doctorId === enc.doctorId) || isSuperAdmin(session);
}

function assertAuthor(enc, session, what = "edit this consultation") {
  if (!isEncounterAuthor(enc, session)) throw forbidden(`Only the treating doctor can ${what}.`);
}

function assertDraft(enc) {
  if (enc.status !== "DRAFT") throw invalidState("This consultation is finalized and read-only. Use an amendment to add corrections.");
}

/** Row lock so concurrent edits / finalization of the same encounter serialise. */
async function lockEncounter(tx, id) {
  const rows = await tx.$queryRaw`SELECT id, status::text AS status, "doctorId" FROM "Encounter" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw notFound("Consultation not found");
  return rows[0];
}

async function loadEncounter(id) {
  const enc = await prisma.encounter.findUnique({ where: { id } });
  if (!enc) throw notFound("Consultation not found");
  return enc;
}

// ───────────────────────────── Queries ─────────────────────────────

export const ENCOUNTER_DETAIL_INCLUDE = {
  patient: {
    select: {
      id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true, bloodGroup: true, medicalAlerts: true, phone: true, status: true,
      allergies: { where: { isActive: true }, orderBy: { createdAt: "desc" }, select: { id: true, substance: true, reaction: true, severity: true } },
    },
  },
  doctor: { select: { id: true, specialty: true, qualifications: true, licenseNumber: true, staff: { select: { firstName: true, lastName: true, userId: true } } } },
  department: { select: { id: true, name: true } },
  appointment: { select: { id: true, appointmentNo: true, startsAt: true, status: true, type: true, reason: true, queueEntry: { select: { tokenNumber: true, status: true } } } },
  diagnoses: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
  notes: { orderBy: { createdAt: "asc" } },
  vitals: { orderBy: { recordedAt: "desc" } },
  prescriptions: { orderBy: { createdAt: "asc" }, include: { items: { include: { medication: { select: { id: true, code: true, genericName: true, brandName: true, strength: true, dosageForm: true } } } } } },
  labOrders: { orderBy: { createdAt: "asc" }, include: { items: { include: { test: { select: { id: true, code: true, name: true, unit: true } }, results: { where: { isCurrent: true }, select: { id: true, value: true, unit: true, referenceRange: true, flag: true } } } } } },
  imagingStudies: { orderBy: { createdAt: "asc" }, include: { report: { select: { impression: true, verifiedAt: true } } } },
};

export function getEncounter(id) {
  return prisma.encounter.findUnique({ where: { id }, include: ENCOUNTER_DETAIL_INCLUDE });
}

/** Resolve author names for notes/amendments (ClinicalNote.authorId has no relation). */
export async function userNames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}

export async function listEncounters(query, tz) {
  const where = {};
  if (query.q) where.OR = [{ encounterNo: { contains: query.q, mode: "insensitive" } }, { patient: patientSearchWhere(query.q) }];
  if (query.status) where.status = query.status;
  if (query.doctorId) where.doctorId = query.doctorId;
  if (query.patientId) where.patientId = query.patientId;
  if (query.from || query.to) {
    where.startedAt = {};
    if (query.from) where.startedAt.gte = dayRangeUtc(query.from, tz)[0];
    if (query.to) where.startedAt.lt = dayRangeUtc(query.to, tz)[1];
  }
  const orderBy = query.status === "FINALIZED" ? [{ finalizedAt: "desc" }, { id: "asc" }] : [{ startedAt: "desc" }, { id: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.encounter.count({ where }),
    prisma.encounter.findMany({
      where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        doctor: { select: { id: true, staff: { select: { firstName: true, lastName: true } } } },
        appointment: { select: { id: true, appointmentNo: true } },
        _count: { select: { diagnoses: true, prescriptions: true } },
      },
    }),
  ]);
  return { rows, meta: pageMeta(total, query.page, query.pageSize) };
}

/** OPD queue for a local date, ordered by doctor then token. */
export async function listQueue({ date, doctorId, includeDone = false }) {
  const queueDate = new Date(`${date}T00:00:00.000Z`);
  const where = { queueDate };
  if (!includeDone) where.status = { in: ["WAITING", "CALLED", "IN_CONSULTATION"] };
  if (doctorId) where.appointment = { doctorId };
  const rows = await prisma.queueEntry.findMany({
    where,
    orderBy: [{ tokenNumber: "asc" }, { createdAt: "asc" }],
    include: {
      appointment: {
        select: {
          id: true, appointmentNo: true, startsAt: true, checkedInAt: true, type: true, status: true, doctorId: true, patientId: true,
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true, _count: { select: { allergies: { where: { isActive: true } } } } } },
          doctor: { select: { id: true, staff: { select: { firstName: true, lastName: true } } } },
          encounter: { select: { id: true, status: true } },
        },
      },
    },
  });
  // Vitals recorded since check-in (linked or not yet linked to an encounter).
  const patientIds = [...new Set(rows.map((r) => r.appointment.patientId))];
  const [dayStart] = dayRangeUtc(date, (await getHospital()).timezone);
  const vitals = patientIds.length
    ? await prisma.vitalSign.findMany({ where: { patientId: { in: patientIds }, recordedAt: { gte: dayStart } }, select: { patientId: true, recordedAt: true } })
    : [];
  const nowMs = Date.now();
  return rows.map((r) => ({
    ...r,
    waitingMinutes: r.appointment.checkedInAt ? Math.max(0, Math.round((nowMs - r.appointment.checkedInAt.getTime()) / 60000)) : null,
    vitalsRecorded: vitals.some((v) => v.patientId === r.appointment.patientId && (!r.appointment.checkedInAt || v.recordedAt >= new Date(r.appointment.checkedInAt.getTime() - 3600000))),
  }));
}

// ───────────────────────────── Start / create ─────────────────────────────

/**
 * CHECKED_IN → IN_PROGRESS: opens (or re-opens) the DRAFT encounter linked to the appointment.
 * Doctor only (the appointment's doctor, SUPER_ADMIN excepted). Idempotent when already in progress.
 */
export async function startConsultation(appointmentId, session, ip, now = new Date()) {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { encounter: { select: { id: true, status: true } } } });
  if (!appt) throw notFound("Appointment not found");
  if (!((session.doctorId && session.doctorId === appt.doctorId) || isSuperAdmin(session))) throw forbidden("Only the patient's assigned doctor can start this consultation.");
  if (appt.status === "IN_PROGRESS" && appt.encounter) return { encounterId: appt.encounter.id, appointmentId, reopened: true };
  if (!APPOINTMENT_ACTIONS.start.from.includes(appt.status)) throw invalidState("Only checked-in patients can be seen. Check the patient in first.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.appointment.updateMany({ where: { id: appointmentId, status: "CHECKED_IN" }, data: { status: "IN_PROGRESS" } });
    if (r.count === 0) throw conflict("The appointment was changed by someone else. Reload and try again.");
    await tx.queueEntry.updateMany({ where: { appointmentId }, data: { status: "IN_CONSULTATION" } });
    let enc = await tx.encounter.findUnique({ where: { appointmentId } });
    if (!enc) {
      enc = await tx.encounter.create({
        data: {
          encounterNo: await newId(tx, "encounter"), patientId: appt.patientId, doctorId: appt.doctorId, departmentId: appt.departmentId,
          appointmentId, type: "OPD", status: "DRAFT", chiefComplaint: appt.reason ?? null, startedAt: now,
        },
      });
      await audit({ userId: session.user.id, action: "encounter.create", entityType: "Encounter", entityId: enc.id, metadata: { encounterNo: enc.encounterNo, appointmentId }, ipAddress: ip }, tx);
    }
    // Attach vitals taken at triage (after check-in) to this encounter.
    await tx.vitalSign.updateMany({
      where: { patientId: appt.patientId, encounterId: null, admissionId: null, recordedAt: { gte: appt.checkedInAt ? new Date(appt.checkedInAt.getTime() - 3600000) : new Date(now.getTime() - 12 * 3600000) } },
      data: { encounterId: enc.id },
    });
    await audit({ userId: session.user.id, action: "appointment.start", entityType: "Appointment", entityId: appointmentId, metadata: { encounterId: enc.id }, ipAddress: ip }, tx);
    return { encounterId: enc.id, appointmentId, reopened: false };
  });
}

/** POST /api/encounters — with an appointment it behaves like "start"; otherwise an ad-hoc OPD consultation by the signed-in doctor. */
export async function createEncounter(input, session, ip, now = new Date()) {
  if (input.appointmentId) {
    const appt = await prisma.appointment.findUnique({ where: { id: input.appointmentId }, select: { patientId: true } });
    if (!appt || appt.patientId !== input.patientId) throw notFound("Appointment not found for this patient");
    return startConsultation(input.appointmentId, session, ip, now);
  }
  if (!session.doctorId) throw forbidden("Only clinicians with a doctor profile can open a consultation.");
  const patient = await prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, status: true } });
  if (!patient || patient.status === "MERGED") throw notFound("Patient not found");
  if (patient.status !== "ACTIVE") throw invalidState("Consultations can only be opened for active patients.");
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: session.doctorId }, select: { id: true, departmentId: true } });
  if (!doctor) throw forbidden("Doctor profile not found.");
  const h = await getHospital();
  const [dayStart] = dayRangeUtc(todayInTz(h.timezone), h.timezone);
  // Re-open today's ad-hoc draft for the same patient instead of creating duplicates.
  const existing = await prisma.encounter.findFirst({ where: { patientId: patient.id, doctorId: doctor.id, appointmentId: null, admissionId: null, status: "DRAFT", startedAt: { gte: dayStart } }, select: { id: true } });
  if (existing) return { encounterId: existing.id, reopened: true };
  return prisma.$transaction(async (tx) => {
    const enc = await tx.encounter.create({
      data: { encounterNo: await newId(tx, "encounter"), patientId: patient.id, doctorId: doctor.id, departmentId: doctor.departmentId, type: "OPD", status: "DRAFT", chiefComplaint: input.chiefComplaint ?? null, startedAt: now },
    });
    await audit({ userId: session.user.id, action: "encounter.create", entityType: "Encounter", entityId: enc.id, metadata: { encounterNo: enc.encounterNo, adHoc: true }, ipAddress: ip }, tx);
    return { encounterId: enc.id, reopened: false };
  });
}

// ───────────────────────────── Documentation ─────────────────────────────

export async function updateEncounter(id, input, session, ip) {
  const enc = await loadEncounter(id);
  assertDraft(enc);
  assertAuthor(enc, session);
  const data = {};
  for (const k of SOAP_FIELDS) if (k in input) data[k] = input[k] ?? null;
  if ("followUpDate" in input) {
    if (input.followUpDate) {
      const h = await getHospital();
      if (input.followUpDate <= todayInTz(h.timezone)) throw invalidState("Follow-up date must be after today.");
      data.followUpDate = new Date(`${input.followUpDate}T00:00:00.000Z`);
    } else data.followUpDate = null;
  }
  const fmt = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));
  const changed = Object.keys(data).filter((k) => fmt(enc[k]) !== fmt(data[k]));
  if (!changed.length) return enc;
  return prisma.$transaction(async (tx) => {
    const r = await tx.encounter.updateMany({ where: { id, status: "DRAFT" }, data });
    if (r.count === 0) throw conflict("This consultation was finalized by someone else. Reload to see the latest version.");
    await audit({ userId: session.user.id, action: "encounter.update", entityType: "Encounter", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return tx.encounter.findUnique({ where: { id } });
  });
}

export async function addDiagnosis(id, input, session, ip) {
  const enc = await loadEncounter(id);
  assertAuthor(enc, session, "record diagnoses");
  return prisma.$transaction(async (tx) => {
    const locked = await lockEncounter(tx, id);
    assertDraft(locked);
    const count = await tx.diagnosis.count({ where: { encounterId: id } });
    if (count >= 20) throw invalidState("A consultation can have at most 20 diagnoses.");
    if (input.isPrimary) await tx.diagnosis.updateMany({ where: { encounterId: id, isPrimary: true }, data: { isPrimary: false } });
    const d = await tx.diagnosis.create({ data: { encounterId: id, code: input.code ? input.code.toUpperCase() : null, description: input.description, isPrimary: !!input.isPrimary } });
    await audit({ userId: session.user.id, action: "encounter.diagnosis_add", entityType: "Encounter", entityId: id, metadata: { diagnosisId: d.id, code: d.code, isPrimary: d.isPrimary }, ipAddress: ip }, tx);
    return d;
  });
}

/** Removal is only possible while the encounter is an unsigned DRAFT; finalized diagnoses are immutable. */
export async function removeDiagnosis(id, diagnosisId, session, ip) {
  const enc = await loadEncounter(id);
  assertAuthor(enc, session, "remove diagnoses");
  return prisma.$transaction(async (tx) => {
    const locked = await lockEncounter(tx, id);
    assertDraft(locked);
    const r = await tx.diagnosis.deleteMany({ where: { id: diagnosisId, encounterId: id } });
    if (r.count === 0) throw notFound("Diagnosis not found");
    await audit({ userId: session.user.id, action: "encounter.diagnosis_remove", entityType: "Encounter", entityId: id, metadata: { diagnosisId }, ipAddress: ip }, tx);
    return { removed: diagnosisId };
  });
}

export async function addNote(id, input, session, ip) {
  const enc = await loadEncounter(id);
  assertAuthor(enc, session, "add consultation notes");
  return prisma.$transaction(async (tx) => {
    const locked = await lockEncounter(tx, id);
    assertDraft(locked);
    const n = await tx.clinicalNote.create({ data: { encounterId: id, kind: input.kind, content: input.content, authorId: session.user.id } });
    await audit({ userId: session.user.id, action: "encounter.note_add", entityType: "Encounter", entityId: id, metadata: { noteId: n.id, kind: n.kind }, ipAddress: ip }, tx);
    return n;
  });
}

function vitalsData(input) {
  const out = {};
  for (const k of ["temperatureC", "weightKg", "heightCm"]) if (input[k] != null) out[k] = Number(input[k]).toFixed(1);
  for (const k of ["pulse", "respRate", "systolic", "diastolic", "spo2"]) if (input[k] != null) out[k] = input[k];
  return out;
}

export async function addEncounterVitals(id, input, session, ip) {
  const enc = await loadEncounter(id);
  assertDraft(enc);
  return prisma.$transaction(async (tx) => {
    const v = await tx.vitalSign.create({ data: { ...vitalsData(input), patientId: enc.patientId, encounterId: id, recordedById: session.user.id } });
    await audit({ userId: session.user.id, action: "vitals.create", entityType: "Encounter", entityId: id, metadata: { vitalSignId: v.id, fields: Object.keys(vitalsData(input)) }, ipAddress: ip }, tx);
    return v;
  });
}

/** Triage vitals from the queue (before or during the consultation). */
export async function addQueueVitals(queueEntryId, input, session, ip) {
  const q = await prisma.queueEntry.findUnique({ where: { id: queueEntryId }, include: { appointment: { select: { id: true, patientId: true, encounter: { select: { id: true, status: true } } } } } });
  if (!q) throw notFound("Queue entry not found");
  if (!["WAITING", "CALLED", "IN_CONSULTATION"].includes(q.status)) throw invalidState("This patient is no longer in the queue.");
  const enc = q.appointment.encounter?.status === "DRAFT" ? q.appointment.encounter.id : null;
  return prisma.$transaction(async (tx) => {
    const v = await tx.vitalSign.create({ data: { ...vitalsData(input), patientId: q.appointment.patientId, encounterId: enc, recordedById: session.user.id } });
    await audit({ userId: session.user.id, action: "vitals.create", entityType: "Appointment", entityId: q.appointment.id, metadata: { vitalSignId: v.id, encounterId: enc, fields: Object.keys(vitalsData(input)) }, ipAddress: ip }, tx);
    return v;
  });
}

export async function callQueueEntry(queueEntryId, session, ip) {
  const q = await prisma.queueEntry.findUnique({ where: { id: queueEntryId } });
  if (!q) throw notFound("Queue entry not found");
  if (q.status !== "WAITING") throw invalidState("Only waiting patients can be called.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.queueEntry.updateMany({ where: { id: queueEntryId, status: "WAITING" }, data: { status: "CALLED" } });
    if (r.count === 0) throw conflict("The queue changed. Reload and try again.");
    await audit({ userId: session.user.id, action: "queue.call", entityType: "Appointment", entityId: q.appointmentId, metadata: { tokenNumber: q.tokenNumber }, ipAddress: ip }, tx);
    return tx.queueEntry.findUnique({ where: { id: queueEntryId } });
  });
}

// ───────────────────────────── Finalize & amend ─────────────────────────────

/**
 * Sign the encounter. Only its own doctor (or SUPER_ADMIN). Requires ≥1 diagnosis and an assessment.
 * In one transaction: encounter FINALIZED, linked appointment COMPLETED, queue entry DONE,
 * DRAFT prescriptions ACTIVE (issuedAt). Pharmacy is notified afterwards (no PHI in the message).
 */
export async function finalizeEncounter(id, session, ip, now = new Date()) {
  const enc = await loadEncounter(id);
  if (!isEncounterAuthor(enc, session)) throw forbidden("Only the treating doctor can finalize this consultation.");
  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockEncounter(tx, id);
    if (locked.status !== "DRAFT") throw invalidState("This consultation has already been finalized.");
    const current = await tx.encounter.findUnique({ where: { id }, select: { assessment: true, appointmentId: true, _count: { select: { diagnoses: true } } } });
    const missing = [];
    if (!current.assessment || !current.assessment.trim()) missing.push("an assessment");
    if (current._count.diagnoses < 1) missing.push("at least one diagnosis");
    if (missing.length) throw invalidState(`Add ${missing.join(" and ")} before finalizing.`);
    await tx.encounter.update({ where: { id }, data: { status: "FINALIZED", finalizedAt: now, finalizedById: session.user.id } });
    let appointmentCompleted = false;
    if (current.appointmentId) {
      const r = await tx.appointment.updateMany({ where: { id: current.appointmentId, status: { in: ["IN_PROGRESS", "CHECKED_IN"] } }, data: { status: "COMPLETED", completedAt: now } });
      appointmentCompleted = r.count > 0;
      await tx.queueEntry.updateMany({ where: { appointmentId: current.appointmentId }, data: { status: "DONE" } });
    }
    const drafts = await tx.prescription.findMany({ where: { encounterId: id, status: "DRAFT" }, select: { id: true, prescriptionNo: true } });
    if (drafts.length) await tx.prescription.updateMany({ where: { id: { in: drafts.map((d) => d.id) }, status: "DRAFT" }, data: { status: "ACTIVE", issuedAt: now } });
    await audit({ userId: session.user.id, action: "encounter.finalize", entityType: "Encounter", entityId: id, metadata: { appointmentId: current.appointmentId, appointmentCompleted, prescriptionsIssued: drafts.map((d) => d.id) }, ipAddress: ip }, tx);
    for (const d of drafts) await audit({ userId: session.user.id, action: "prescription.issue", entityType: "Prescription", entityId: d.id, metadata: { encounterId: id }, ipAddress: ip }, tx);
    return { id, status: "FINALIZED", prescriptionsIssued: drafts };
  });
  if (result.prescriptionsIssued.length) {
    try {
      const one = result.prescriptionsIssued.length === 1 ? result.prescriptionsIssued[0] : null;
      await notifyPermission(["pharmacy:dispense"], {
        category: "PHARMACY",
        title: result.prescriptionsIssued.length === 1 ? "New prescription ready for dispensing" : `${result.prescriptionsIssued.length} new prescriptions ready for dispensing`,
        body: result.prescriptionsIssued.map((d) => d.prescriptionNo).join(", "),
        link: one ? `/pharmacy/prescriptions/${one.id}` : "/pharmacy",
      });
    } catch (e) {
      console.error("[encounters] pharmacy notification failed:", e?.code || e?.name || "error");
    }
  }
  return result;
}

/** Amendments never overwrite: they append a ClinicalNote (kind AMENDMENT) with author, time and reason. */
export async function amendEncounter(id, input, session, ip) {
  const enc = await loadEncounter(id);
  if (enc.status !== "FINALIZED") throw invalidState("Only finalized consultations are amended. Edit the draft directly instead.");
  if (!isEncounterAuthor(enc, session)) throw forbidden("Only the treating doctor can amend this consultation.");
  return prisma.$transaction(async (tx) => {
    const n = await tx.clinicalNote.create({ data: { encounterId: id, kind: "AMENDMENT", content: input.content, reason: input.reason, authorId: session.user.id } });
    await audit({ userId: session.user.id, action: "encounter.amend", entityType: "Encounter", entityId: id, metadata: { noteId: n.id }, ipAddress: ip }, tx);
    return n;
  });
}
