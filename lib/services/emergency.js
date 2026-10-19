import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState, badRequest } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { createPatient } from "@/lib/services/patients";
import { getSetting } from "@/lib/services/settings";
import { canErTransition, canTriage, isErActive, ER_ACTIVE_STATUSES, dispositionText } from "@/lib/validation/emergency";
import { userNames, advisoryLock } from "@/lib/services/admissions";
import { dayRangeUtc } from "@/lib/utils/time";

const patientSelect = { id: true, mrn: true, firstName: true, lastName: true, sex: true, dateOfBirth: true, phone: true };

export async function getTriageCategories() {
  const s = await getSetting("emergency");
  const cats = Array.isArray(s?.triageCategories) ? s.triageCategories : [];
  return cats.filter((c) => c && c.key).map((c) => ({ key: String(c.key), label: String(c.label || c.key), color: String(c.color || "#64748b") }));
}

/** Users who can be assigned as the treating clinician (active accounts holding the DOCTOR role). */
export async function listClinicians(q) {
  return prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { key: "DOCTOR" } } }, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true, staff: { select: { position: true, department: { select: { name: true } } } } },
  });
}

async function assertClinician(userId) {
  const u = await prisma.user.findFirst({ where: { id: userId, isActive: true, roles: { some: { role: { key: "DOCTOR" } } } }, select: { id: true, name: true } });
  if (!u) throw badRequest("Choose an active doctor.", { clinicianId: "Choose an active doctor" });
  return u;
}

function searchWhere(q) {
  if (!q) return {};
  const ci = (v) => ({ contains: v, mode: "insensitive" });
  const parts = q.trim().split(/\s+/);
  const p = [{ mrn: ci(q) }, { phone: { contains: q } }, { firstName: ci(q) }, { lastName: ci(q) }];
  if (parts.length > 1) p.push({ AND: [{ firstName: ci(parts[0]) }, { lastName: ci(parts.slice(1).join(" ")) }] });
  return { OR: [{ visitNo: ci(q) }, { presentingComplaint: ci(q) }, { patient: { OR: p } }] };
}

/** Live board: every visit still in the department (oldest arrival first). */
export async function getActiveBoard({ q, status, category } = {}) {
  const where = {
    ...searchWhere(q),
    status: status && ER_ACTIVE_STATUSES.includes(status) ? status : { in: ER_ACTIVE_STATUSES },
    ...(category ? { triageCategory: category } : {}),
  };
  const rows = await prisma.emergencyVisit.findMany({ where, orderBy: { arrivedAt: "asc" }, take: 300, include: { patient: { select: patientSelect } } });
  const names = await userNames(rows.flatMap((r) => [r.assignedClinicianId, r.triagedById]));
  return rows.map((r) => ({ ...r, clinicianName: names[r.assignedClinicianId] || null, triagedByName: names[r.triagedById] || null }));
}

/** Closed visits (dispositioned), paginated. */
export async function listClosedVisits({ q, page, pageSize, status, from, to }, tz) {
  const closed = ["ADMITTED", "TRANSFERRED", "DISCHARGED", "LEFT_WITHOUT_BEING_SEEN"];
  const where = { ...searchWhere(q), status: status && closed.includes(status) ? status : { in: closed } };
  if (from || to) {
    where.arrivedAt = {};
    if (from) where.arrivedAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.arrivedAt.lt = dayRangeUtc(to, tz)[1];
  }
  const [total, rows] = await Promise.all([
    prisma.emergencyVisit.count({ where }),
    prisma.emergencyVisit.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { patient: { select: patientSelect } } }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function getVisit(id) {
  const v = await prisma.emergencyVisit.findUnique({
    where: { id },
    include: {
      patient: { select: { ...patientSelect, bloodGroup: true, medicalAlerts: true, status: true, allergies: { where: { isActive: true }, select: { id: true, substance: true, reaction: true, severity: true } } } },
      dispatches: { orderBy: { dispatchedAt: "desc" }, include: { ambulance: { select: { vehicleNo: true, type: true } } } },
    },
  });
  if (!v) return null;
  const names = await userNames([v.assignedClinicianId, v.triagedById]);
  return { ...v, clinicianName: names[v.assignedClinicianId] || null, triagedByName: names[v.triagedById] || null };
}

export async function getVisitActivity(id) {
  return prisma.auditLog.findMany({ where: { entityType: "EmergencyVisit", entityId: id, action: { not: "emergency.view" } }, orderBy: { createdAt: "asc" }, take: 200, include: { user: { select: { name: true } } } });
}

export async function registerVisit(input, session, ip) {
  let patientId = input.patientId;
  let quickRegistered = false;
  if (input.patientMode === "NEW") {
    // Quick registration: duplicates are accepted deliberately (identity is reconciled later via merge).
    const p = await createPatient({ ...input.newPatient, confirmDuplicate: true }, session, ip);
    patientId = p.id;
    quickRegistered = true;
  } else {
    const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true, status: true } });
    if (!p || p.status === "MERGED") throw badRequest("Select a valid patient.", { patientId: "Select a valid patient" });
    if (p.status === "DECEASED") throw invalidState("This patient record is marked deceased.");
  }
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, "er:patient", patientId);
    const open = await tx.emergencyVisit.findFirst({ where: { patientId, status: { in: ER_ACTIVE_STATUSES } }, select: { id: true, visitNo: true } });
    if (open) throw conflict(`This patient already has an open ER visit (${open.visitNo}).`, { visitId: open.id });
    const visitNo = await newId(tx, "emergency");
    const v = await tx.emergencyVisit.create({
      data: { visitNo, patientId, arrivalMode: input.arrivalMode, presentingComplaint: input.presentingComplaint, initialObservations: input.initialObservations ?? null },
    });
    await audit({ userId: session.user.id, action: "emergency.register", entityType: "EmergencyVisit", entityId: v.id, metadata: { visitNo, patientId, arrivalMode: input.arrivalMode, quickRegistered }, ipAddress: ip }, tx);
    return v;
  });
}

export async function triageVisit(id, { triageCategory, initialObservations }, session, ip) {
  const cats = await getTriageCategories();
  if (!cats.some((c) => c.key === triageCategory)) throw badRequest("Choose a configured triage category.", { triageCategory: "Choose a configured triage category" });
  const v = await prisma.emergencyVisit.findUnique({ where: { id }, select: { id: true, status: true, triageCategory: true } });
  if (!v) throw notFound();
  if (!canTriage(v.status)) throw invalidState("Triage can only be recorded while the patient is in the department.");
  const nextStatus = v.status === "WAITING_TRIAGE" ? "TRIAGED" : v.status;
  return prisma.$transaction(async (tx) => {
    const r = await tx.emergencyVisit.updateMany({
      where: { id, status: v.status },
      data: { triageCategory, triagedById: session.user.id, status: nextStatus, ...(initialObservations !== undefined ? { initialObservations } : {}) },
    });
    if (r.count === 0) throw conflict("The visit was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: v.triageCategory ? "emergency.retriage" : "emergency.triage", entityType: "EmergencyVisit", entityId: id, metadata: { from: v.triageCategory, to: triageCategory, status: nextStatus, observationsUpdated: initialObservations !== undefined }, ipAddress: ip }, tx);
    return { id, status: nextStatus, triageCategory };
  });
}

export async function assignClinician(id, { clinicianId }, session, ip) {
  const doc = await assertClinician(clinicianId);
  const v = await prisma.emergencyVisit.findUnique({ where: { id }, select: { id: true, status: true, assignedClinicianId: true } });
  if (!v) throw notFound();
  if (!isErActive(v.status)) throw invalidState("This visit is closed.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.emergencyVisit.updateMany({ where: { id, status: { in: ER_ACTIVE_STATUSES } }, data: { assignedClinicianId: doc.id } });
    if (r.count === 0) throw conflict("The visit was closed by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "emergency.assign", entityType: "EmergencyVisit", entityId: id, metadata: { from: v.assignedClinicianId, to: doc.id }, ipAddress: ip }, tx);
    return { id, assignedClinicianId: doc.id };
  });
}

export async function startTreatment(id, { clinicianId }, session, ip) {
  const v = await prisma.emergencyVisit.findUnique({ where: { id }, select: { id: true, status: true, assignedClinicianId: true } });
  if (!v) throw notFound();
  if (!canErTransition(v.status, "UNDER_TREATMENT")) throw invalidState(v.status === "WAITING_TRIAGE" ? "Triage the patient before starting treatment." : "Treatment cannot be started from the current status.");
  const clinician = clinicianId || v.assignedClinicianId;
  if (!clinician) throw badRequest("Assign a treating clinician first.", { clinicianId: "Assign a treating clinician" });
  if (clinicianId) await assertClinician(clinicianId);
  return prisma.$transaction(async (tx) => {
    const r = await tx.emergencyVisit.updateMany({ where: { id, status: v.status }, data: { status: "UNDER_TREATMENT", assignedClinicianId: clinician } });
    if (r.count === 0) throw conflict("The visit was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "emergency.status", entityType: "EmergencyVisit", entityId: id, metadata: { from: v.status, to: "UNDER_TREATMENT", clinicianId: clinician }, ipAddress: ip }, tx);
    return { id, status: "UNDER_TREATMENT" };
  });
}

export async function setDisposition(id, input, session, ip) {
  const v = await prisma.emergencyVisit.findUnique({ where: { id }, select: { id: true, status: true, patientId: true } });
  if (!v) throw notFound();
  if (!canErTransition(v.status, input.disposition)) {
    throw invalidState(`A visit that is ${v.status.toLowerCase().replace(/_/g, " ")} cannot be closed as ${input.disposition.toLowerCase().replace(/_/g, " ")}.`);
  }
  return prisma.$transaction(async (tx) => {
    const r = await tx.emergencyVisit.updateMany({ where: { id, status: v.status }, data: { status: input.disposition, disposition: dispositionText(input) } });
    if (r.count === 0) throw conflict("The visit was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "emergency.disposition", entityType: "EmergencyVisit", entityId: id, metadata: { from: v.status, to: input.disposition, hasDestination: !!input.destination }, ipAddress: ip }, tx);
    return { id, status: input.disposition, patientId: v.patientId };
  });
}

/** Open visits for linking an ambulance dispatch. */
export async function listOpenVisitOptions() {
  const rows = await prisma.emergencyVisit.findMany({ where: { status: { in: ER_ACTIVE_STATUSES } }, orderBy: { arrivedAt: "desc" }, take: 100, select: { id: true, visitNo: true, patient: { select: { firstName: true, lastName: true } } } });
  return rows.map((r) => ({ id: r.id, label: `${r.visitNo} — ${r.patient.firstName} ${r.patient.lastName}` }));
}
