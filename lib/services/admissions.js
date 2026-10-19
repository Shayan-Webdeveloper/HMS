import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/session";
import { conflict, notFound, invalidState, badRequest, forbidden } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { notifyPermission } from "@/lib/services/notifications";
import { getHospital } from "@/lib/services/settings";
import { zonedToUtc, todayInTz } from "@/lib/utils/time";

const SORTABLE = { admittedAt: "admittedAt", admissionNo: "admissionNo", dischargedAt: "dischargedAt", expectedDischargeAt: "expectedDischargeAt" };

/** Serialise concurrent writers on the same key for the rest of the transaction. */
export async function advisoryLock(tx, namespace, key) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${namespace}), hashtext(${key}))`;
}

export async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}

function admissionSearchWhere(q) {
  if (!q) return {};
  const ci = (v) => ({ contains: v, mode: "insensitive" });
  const parts = q.trim().split(/\s+/);
  const patientOr = [{ mrn: ci(q) }, { phone: { contains: q } }, { firstName: ci(q) }, { lastName: ci(q) }];
  if (parts.length > 1) patientOr.push({ AND: [{ firstName: ci(parts[0]) }, { lastName: ci(parts.slice(1).join(" ")) }] });
  return { OR: [{ admissionNo: ci(q) }, { patient: { OR: patientOr } }] };
}

export async function listAdmissions({ q, page, pageSize, sort, dir, status, wardId }) {
  const st = status || "ADMITTED";
  const where = { ...admissionSearchWhere(q), ...(st === "ALL" ? {} : { status: st }) };
  if (wardId) where.bedAssignments = { some: { bed: { wardId }, ...(st === "ADMITTED" ? { endedAt: null } : {}) } };
  const orderBy = [{ [SORTABLE[sort] || "admittedAt"]: dir }, { admissionNo: "desc" }];
  const [total, rows] = await Promise.all([
    prisma.admission.count({ where }),
    prisma.admission.findMany({
      where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, admissionNo: true, status: true, admittedAt: true, dischargedAt: true, expectedDischargeAt: true, reason: true,
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true, sex: true, dateOfBirth: true } },
        doctor: { select: { id: true, staff: { select: { firstName: true, lastName: true } } } },
        bedAssignments: { orderBy: { startedAt: "desc" }, take: 1, select: { endedAt: true, bed: { select: { id: true, label: true, ward: { select: { id: true, name: true, code: true } } } } } },
      },
    }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function getAdmission(id) {
  const a = await prisma.admission.findUnique({
    where: { id },
    include: {
      patient: {
        select: {
          id: true, mrn: true, firstName: true, lastName: true, sex: true, dateOfBirth: true, phone: true, address: true, city: true, bloodGroup: true, medicalAlerts: true, status: true,
          allergies: { where: { isActive: true }, orderBy: { createdAt: "desc" }, select: { id: true, substance: true, reaction: true, severity: true } },
          emergencyContacts: { take: 1, select: { name: true, relationship: true, phone: true } },
        },
      },
      doctor: { select: { id: true, specialty: true, staff: { select: { firstName: true, lastName: true } }, department: { select: { name: true } } } },
      bedAssignments: { orderBy: { startedAt: "asc" }, include: { bed: { select: { id: true, label: true, ward: { select: { id: true, name: true, code: true, type: true, dailyRate: true } } } } } },
      _count: { select: { notes: true, vitals: true, medAdministrations: true } },
    },
  });
  return a;
}

export async function getOpenAdmissionForPatient(patientId) {
  return prisma.admission.findFirst({ where: { patientId, status: "ADMITTED" }, select: { id: true, admissionNo: true } });
}

function expectedDischarge(dateStr, tz) {
  if (!dateStr) return null;
  if (dateStr < todayInTz(tz)) throw badRequest("Expected discharge cannot be in the past.", { expectedDischargeDate: "Expected discharge cannot be in the past" });
  return zonedToUtc(dateStr, "12:00", tz);
}

export async function admitPatient(input, session, ip) {
  const h = await getHospital();
  const [patient, doctor, bed] = await Promise.all([
    prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, status: true } }),
    prisma.doctorProfile.findUnique({ where: { id: input.doctorId }, select: { id: true, staff: { select: { employmentStatus: true } } } }),
    prisma.bed.findUnique({ where: { id: input.bedId }, select: { id: true, label: true, status: true, wardId: true, ward: { select: { id: true, name: true, isActive: true } } } }),
  ]);
  if (!patient || patient.status === "MERGED") throw badRequest("Select a valid patient.", { patientId: "Select a valid patient" });
  if (patient.status !== "ACTIVE") throw invalidState("Only active patient records can be admitted.");
  if (!doctor || doctor.staff.employmentStatus !== "ACTIVE") throw badRequest("Choose an active admitting doctor.", { doctorId: "Choose an active admitting doctor" });
  if (!bed || bed.wardId !== input.wardId || !bed.ward.isActive) throw badRequest("Choose an available bed in the selected ward.", { bedId: "Choose an available bed" });
  if (bed.status !== "AVAILABLE") throw conflict("That bed is no longer available. Choose another bed.", { bedId: "Bed no longer available" });
  const expectedDischargeAt = expectedDischarge(input.expectedDischargeDate, h.timezone);

  return prisma.$transaction(async (tx) => {
    // One open admission per patient: serialise admissions for the same patient.
    await advisoryLock(tx, "admission:patient", patient.id);
    const open = await tx.admission.findFirst({ where: { patientId: patient.id, status: "ADMITTED" }, select: { id: true, admissionNo: true } });
    if (open) throw conflict(`This patient is already admitted (${open.admissionNo}).`, { admissionId: open.id });
    const admissionNo = await newId(tx, "admission");
    const adm = await tx.admission.create({
      data: { admissionNo, patientId: patient.id, doctorId: doctor.id, reason: input.reason, expectedDischargeAt, createdById: session.user.id },
    });
    const claimed = await tx.bed.updateMany({
      where: { id: bed.id, status: "AVAILABLE", currentAdmissionId: null },
      data: { status: "OCCUPIED", currentAdmissionId: adm.id, version: { increment: 1 } },
    });
    if (claimed.count === 0) throw conflict("That bed was just taken. Choose another bed.", { bedId: "Bed was just taken" });
    await tx.bedAssignment.create({ data: { admissionId: adm.id, bedId: bed.id, startedAt: adm.admittedAt, assignedById: session.user.id } });
    await audit({ userId: session.user.id, action: "admission.create", entityType: "Admission", entityId: adm.id, metadata: { admissionNo, patientId: patient.id, bedId: bed.id, wardId: bed.wardId, doctorId: doctor.id }, ipAddress: ip }, tx);
    await notifyPermission(["nursing:create"], {
      category: "ADMISSION", title: "New admission",
      body: `${admissionNo} admitted to ${bed.ward.name}, bed ${bed.label}.`, link: `/admissions/${adm.id}`,
    }, tx);
    return adm;
  });
}

export async function transferPatient(id, { bedId, reason }, session, ip) {
  const target = await prisma.bed.findUnique({ where: { id: bedId }, select: { id: true, label: true, status: true, wardId: true, ward: { select: { name: true, isActive: true } } } });
  if (!target || !target.ward.isActive) throw badRequest("Choose an available bed.", { bedId: "Choose an available bed" });
  if (target.status !== "AVAILABLE" && target.status !== "OCCUPIED") throw conflict("That bed is not available. Choose another bed.", { bedId: "Bed not available" });
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, "admission", id);
    const adm = await tx.admission.findUnique({ where: { id }, select: { id: true, status: true, admissionNo: true, bedAssignments: { where: { endedAt: null }, select: { id: true, bedId: true } } } });
    if (!adm) throw notFound();
    if (adm.status !== "ADMITTED") throw invalidState("Only currently admitted patients can be transferred.");
    const current = adm.bedAssignments[0];
    if (current?.bedId === bedId) throw invalidState("The patient is already in this bed.");
    const now = new Date();
    if (current) {
      const ended = await tx.bedAssignment.updateMany({ where: { id: current.id, endedAt: null }, data: { endedAt: now, reason } });
      if (ended.count === 0) throw conflict("The bed assignment changed. Refresh and try again.");
      // Release first: the unique occupancy pointer forbids one admission in two beds.
      await tx.bed.updateMany({ where: { id: current.bedId, currentAdmissionId: id }, data: { status: "CLEANING", currentAdmissionId: null, version: { increment: 1 } } });
    }
    const claimed = await tx.bed.updateMany({
      where: { id: bedId, status: "AVAILABLE", currentAdmissionId: null },
      data: { status: "OCCUPIED", currentAdmissionId: id, version: { increment: 1 } },
    });
    if (claimed.count === 0) throw conflict("That bed was just taken. Choose another bed.", { bedId: "Bed was just taken" });
    await tx.bedAssignment.create({ data: { admissionId: id, bedId, startedAt: now, assignedById: session.user.id } });
    await audit({ userId: session.user.id, action: "admission.transfer", entityType: "Admission", entityId: id, metadata: { fromBedId: current?.bedId ?? null, toBedId: bedId, reason }, ipAddress: ip }, tx);
    await notifyPermission(["nursing:create"], {
      category: "ADMISSION", title: "Patient transferred",
      body: `${adm.admissionNo} moved to ${target.ward.name}, bed ${target.label}.`, link: `/admissions/${id}`,
    }, tx);
    return { id, bedId };
  });
}

export async function dischargePatient(id, input, session, ip) {
  const h = await getHospital();
  const adm = await prisma.admission.findUnique({ where: { id }, select: { id: true, status: true, admissionNo: true, patientId: true, admittedAt: true, bedAssignments: { where: { endedAt: null }, select: { startedAt: true, bedId: true } } } });
  if (!adm) throw notFound();
  if (adm.status !== "ADMITTED") throw invalidState("Only admitted patients can be discharged.");
  const dischargedAt = input.dischargeDate ? zonedToUtc(input.dischargeDate, input.dischargeTime, h.timezone) : new Date();
  if (dischargedAt.getTime() > Date.now() + 5 * 60000) throw badRequest("Discharge time cannot be in the future.", { dischargeTime: "Cannot be in the future" });
  const earliest = Math.max(adm.admittedAt.getTime(), ...adm.bedAssignments.map((b) => b.startedAt.getTime()));
  if (dischargedAt.getTime() < earliest) throw badRequest("Discharge time is before the admission or last bed move.", { dischargeTime: "Before admission / last bed move" });

  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, "admission", id);
    const r = await tx.admission.updateMany({
      where: { id, status: "ADMITTED" },
      data: { status: "DISCHARGED", dischargedAt, dischargeSummary: input.dischargeSummary, dischargeCondition: input.dischargeCondition },
    });
    if (r.count === 0) throw conflict("This admission was already discharged or changed. Refresh to see the latest state.");
    await tx.bedAssignment.updateMany({ where: { admissionId: id, endedAt: null }, data: { endedAt: dischargedAt, reason: "Discharged" } });
    const released = await tx.bed.updateMany({ where: { currentAdmissionId: id }, data: { status: "CLEANING", currentAdmissionId: null, version: { increment: 1 } } });
    await audit({ userId: session.user.id, action: "admission.discharge", entityType: "Admission", entityId: id, metadata: { admissionNo: adm.admissionNo, dischargedAt: dischargedAt.toISOString(), bedsReleased: released.count }, ipAddress: ip }, tx);
    await notifyPermission(["billing:create"], {
      category: "BILLING", title: "Bed charges ready",
      body: `${adm.admissionNo} has been discharged. Bed-day charges are ready to invoice.`, link: `/billing?patientId=${adm.patientId}`,
    }, tx);
    return { id, status: "DISCHARGED", dischargedAt };
  });
}

async function requireOpenAdmission(id) {
  const adm = await prisma.admission.findUnique({ where: { id }, select: { id: true, status: true, patientId: true } });
  if (!adm) throw notFound();
  if (adm.status !== "ADMITTED") throw invalidState("This admission is closed. Clinical entries can only be added while the patient is admitted.");
  return adm;
}

export async function recordVitals(id, input, session, ip) {
  const adm = await requireOpenAdmission(id);
  const v = await prisma.$transaction(async (tx) => {
    const row = await tx.vitalSign.create({
      data: {
        patientId: adm.patientId, admissionId: id, recordedById: session.user.id,
        temperatureC: input.temperatureC != null ? String(input.temperatureC) : null,
        pulse: input.pulse ?? null, respRate: input.respRate ?? null, systolic: input.systolic ?? null, diastolic: input.diastolic ?? null, spo2: input.spo2 ?? null,
        weightKg: input.weightKg != null ? String(input.weightKg) : null, heightCm: input.heightCm != null ? String(input.heightCm) : null,
      },
    });
    await audit({ userId: session.user.id, action: "vitals.create", entityType: "Admission", entityId: id, metadata: { vitalSignId: row.id }, ipAddress: ip }, tx);
    return row;
  });
  return v;
}

export async function listVitals(id) {
  const rows = await prisma.vitalSign.findMany({ where: { admissionId: id }, orderBy: { recordedAt: "asc" }, take: 500 });
  const names = await userNames(rows.map((r) => r.recordedById));
  return rows.map((r) => ({ ...r, recordedByName: names[r.recordedById] || "—" }));
}

export async function addAdmissionNote(id, { kind, content }, session, ip) {
  if (kind === "NURSING" && !can(session, "nursing:create")) throw forbidden("Nursing notes require the nursing permission.");
  if (kind !== "NURSING" && !can(session, "encounters:create")) throw forbidden("Progress and round notes are written by clinicians.");
  await requireOpenAdmission(id);
  return prisma.$transaction(async (tx) => {
    const n = await tx.clinicalNote.create({ data: { admissionId: id, kind, content, authorId: session.user.id } });
    await audit({ userId: session.user.id, action: "admission.note", entityType: "Admission", entityId: id, metadata: { noteId: n.id, kind }, ipAddress: ip }, tx);
    return n;
  });
}

export async function listNotes(id, kinds) {
  const rows = await prisma.clinicalNote.findMany({ where: { admissionId: id, ...(kinds ? { kind: { in: kinds } } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
  const names = await userNames(rows.map((r) => r.authorId));
  return rows.map((r) => ({ ...r, authorName: names[r.authorId] || "—" }));
}

/** Prescription items that can be administered: from the patient's ACTIVE / PARTIALLY_DISPENSED prescriptions. */
export async function listAdministrableItems(patientId) {
  const items = await prisma.prescriptionItem.findMany({
    where: { prescription: { patientId, status: { in: ["ACTIVE", "PARTIALLY_DISPENSED"] } } },
    orderBy: { prescription: { createdAt: "desc" } },
    take: 100,
    select: {
      id: true, dose: true, route: true, frequency: true, durationDays: true, instructions: true,
      medication: { select: { genericName: true, brandName: true, strength: true, dosageForm: true } },
      prescription: { select: { prescriptionNo: true, status: true } },
    },
  });
  return items.map((i) => ({ ...i, label: medicationLabel(i.medication) }));
}

export const medicationLabel = (m) => `${m.genericName} ${m.strength}${m.brandName ? ` (${m.brandName})` : ""}`;

export async function recordAdministration(id, input, session, ip) {
  const adm = await requireOpenAdmission(id);
  let medicationName = input.medicationName;
  let prescriptionItemId = null;
  if (input.prescriptionItemId) {
    const item = await prisma.prescriptionItem.findFirst({
      where: { id: input.prescriptionItemId, prescription: { patientId: adm.patientId, status: { in: ["ACTIVE", "PARTIALLY_DISPENSED"] } } },
      select: { id: true, medication: { select: { genericName: true, brandName: true, strength: true } } },
    });
    if (!item) throw badRequest("That prescription item is not active for this patient.", { prescriptionItemId: "Not an active prescription item for this patient" });
    prescriptionItemId = item.id;
    medicationName = medicationLabel(item.medication);
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.medicationAdministration.create({
      data: { admissionId: id, prescriptionItemId, medicationName, dose: input.dose, status: input.status, note: input.note ?? null, administeredById: session.user.id },
    });
    await audit({ userId: session.user.id, action: "mar.record", entityType: "Admission", entityId: id, metadata: { administrationId: row.id, status: input.status, prescriptionItemId }, ipAddress: ip }, tx);
    return row;
  });
}

export async function listAdministrations(id) {
  const rows = await prisma.medicationAdministration.findMany({ where: { admissionId: id }, orderBy: { administeredAt: "desc" }, take: 300 });
  const names = await userNames(rows.map((r) => r.administeredById));
  return rows.map((r) => ({ ...r, administeredByName: names[r.administeredById] || "—" }));
}

export async function listWardFilterOptions() {
  return prisma.ward.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}
