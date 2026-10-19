import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { dayRangeUtc } from "@/lib/utils/time";

const SORTABLE = { name: ["lastName", "firstName"], mrn: ["mrn"], registeredAt: ["registeredAt"], dateOfBirth: ["dateOfBirth"] };

export function patientSearchWhere(q) {
  if (!q) return {};
  const ci = (v) => ({ contains: v, mode: "insensitive" });
  const parts = q.trim().split(/\s+/);
  const or = [{ mrn: ci(q) }, { phone: { contains: q.replace(/\s+/g, " ") } }, { firstName: ci(q) }, { lastName: ci(q) }, { email: ci(q) }];
  if (parts.length > 1) or.push({ AND: [{ firstName: ci(parts[0]) }, { lastName: ci(parts.slice(1).join(" ")) }] });
  return { OR: or };
}

export async function listPatients({ q, page, pageSize, sort, dir, status, from, to }, tz) {
  const where = { ...patientSearchWhere(q), status: status || { in: ["ACTIVE"] } };
  if (status === "ALL") where.status = { not: "MERGED" };
  if (from || to) {
    where.registeredAt = {};
    if (from) where.registeredAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.registeredAt.lt = dayRangeUtc(to, tz)[1];
  }
  const fields = SORTABLE[sort] || ["registeredAt"];
  const orderBy = fields.map((f) => ({ [f]: dir }));
  const [total, rows] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({
      where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true, phone: true, city: true, status: true, registeredAt: true, bloodGroup: true, _count: { select: { allergies: { where: { isActive: true } } } } },
    }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function findDuplicates({ firstName, lastName, dateOfBirth, phone }, excludeId) {
  const or = [];
  if (dateOfBirth) or.push({ firstName: { equals: firstName, mode: "insensitive" }, lastName: { equals: lastName, mode: "insensitive" }, dateOfBirth: new Date(dateOfBirth) });
  if (phone) or.push({ phone, firstName: { equals: firstName, mode: "insensitive" } });
  if (!or.length) return [];
  return prisma.patient.findMany({
    where: { OR: or, status: { not: "MERGED" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, phone: true },
    take: 5,
  });
}

function toData(input) {
  return {
    firstName: input.firstName, lastName: input.lastName,
    dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
    sex: input.sex, phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null,
    address: input.address ?? null, city: input.city ?? null, bloodGroup: input.bloodGroup ?? null,
    medicalAlerts: input.medicalAlerts ?? null, consentToSms: !!input.consentToSms, consentToEmail: !!input.consentToEmail,
  };
}

export async function createPatient(input, session, ip) {
  if (!input.confirmDuplicate) {
    const dups = await findDuplicates(input);
    if (dups.length) throw conflict("Possible duplicate patient found. Review the matches or confirm to register anyway.", { duplicates: dups });
  }
  return prisma.$transaction(async (tx) => {
    const p = await tx.patient.create({
      data: {
        ...toData(input),
        mrn: await newId(tx, "patient"),
        createdById: session.user.id,
        emergencyContacts: input.emergencyContactName && input.emergencyContactPhone
          ? { create: [{ name: input.emergencyContactName, relationship: input.emergencyContactRelationship ?? null, phone: input.emergencyContactPhone }] }
          : undefined,
      },
    });
    await audit({ userId: session.user.id, action: "patient.create", entityType: "Patient", entityId: p.id, ipAddress: ip }, tx);
    return p;
  });
}

export async function updatePatient(id, input, session, ip) {
  const existing = await prisma.patient.findUnique({ where: { id }, include: { emergencyContacts: true } });
  if (!existing || existing.status === "MERGED") throw notFound();
  const data = toData(input);
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  return prisma.$transaction(async (tx) => {
    const p = await tx.patient.update({ where: { id }, data });
    if (input.emergencyContactName && input.emergencyContactPhone) {
      const ec = existing.emergencyContacts[0];
      const ecData = { name: input.emergencyContactName, relationship: input.emergencyContactRelationship ?? null, phone: input.emergencyContactPhone };
      if (ec) await tx.emergencyContact.update({ where: { id: ec.id }, data: ecData });
      else await tx.emergencyContact.create({ data: { ...ecData, patientId: id } });
    }
    // Field names only — never values — in the audit trail.
    await audit({ userId: session.user.id, action: "patient.update", entityType: "Patient", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return p;
  });
}

export async function setPatientArchived(id, archived, reason, session, ip) {
  const p = await prisma.patient.findUnique({ where: { id } });
  if (!p || p.status === "MERGED") throw notFound();
  if (archived && p.status !== "ACTIVE") throw invalidState("Only active patients can be archived.");
  if (!archived && p.status !== "ARCHIVED") throw invalidState("Patient is not archived.");
  if (archived) {
    const open = await prisma.admission.count({ where: { patientId: id, status: "ADMITTED" } });
    if (open) throw invalidState("Patient has an active admission. Discharge before archiving.");
  }
  return prisma.$transaction(async (tx) => {
    const r = await tx.patient.update({ where: { id }, data: { status: archived ? "ARCHIVED" : "ACTIVE" } });
    await audit({ userId: session.user.id, action: archived ? "patient.archive" : "patient.restore", entityType: "Patient", entityId: id, metadata: { reason }, ipAddress: ip }, tx);
    return r;
  });
}

/**
 * Controlled merge: moves all clinical/financial records from `sourceId` to `targetId`,
 * marks the source MERGED (never deleted), and records an audit entry.
 */
export async function mergePatients(sourceId, targetId, reason, session, ip) {
  if (sourceId === targetId) throw invalidState("Choose two different patients.");
  const [src, tgt] = await Promise.all([prisma.patient.findUnique({ where: { id: sourceId }, include: { userLink: true } }), prisma.patient.findUnique({ where: { id: targetId }, include: { userLink: true } })]);
  if (!src || !tgt || src.status === "MERGED" || tgt.status === "MERGED") throw notFound();
  if (src.userLink && tgt.userLink) throw invalidState("Both records have portal accounts. Unlink one before merging.");
  return prisma.$transaction(async (tx) => {
    const move = { where: { patientId: sourceId }, data: { patientId: targetId } };
    const tables = ["emergencyContact", "allergy", "medicalHistory", "appointment", "encounter", "vitalSign", "prescription", "labOrder", "imagingStudy", "admission", "invoice", "insurancePolicy", "uploadedDocument", "procedure", "emergencyVisit"];
    const counts = {};
    for (const t of tables) counts[t] = (await tx[t].updateMany(move)).count;
    if (src.userLink) await tx.patientUserLink.update({ where: { id: src.userLink.id }, data: { patientId: targetId } });
    await tx.patient.update({ where: { id: sourceId }, data: { status: "MERGED", mergedIntoId: targetId } });
    await audit({ userId: session.user.id, action: "patient.merge", entityType: "Patient", entityId: targetId, metadata: { sourceId, sourceMrn: src.mrn, reason, moved: counts }, ipAddress: ip }, tx);
    return { targetId, moved: counts };
  });
}

export async function getPatientProfile(id) {
  const p = await prisma.patient.findUnique({
    where: { id },
    include: {
      emergencyContacts: true,
      allergies: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
      medicalHistory: { orderBy: { createdAt: "desc" } },
      userLink: { select: { id: true, verifiedAt: true } },
      _count: { select: { appointments: true, encounters: true, admissions: true, invoices: true, labOrders: true, prescriptions: true, documents: true } },
    },
  });
  if (!p) return null;
  return p;
}

/** Chronological timeline of key events (clinical items only included when allowed). */
export async function getPatientTimeline(id, { clinical }) {
  const [appts, encs, adms, labs, invs] = await Promise.all([
    prisma.appointment.findMany({ where: { patientId: id }, orderBy: { startsAt: "desc" }, take: 30, include: { doctor: { include: { staff: true } } } }),
    clinical ? prisma.encounter.findMany({ where: { patientId: id }, orderBy: { startedAt: "desc" }, take: 30, include: { diagnoses: true } }) : [],
    prisma.admission.findMany({ where: { patientId: id }, orderBy: { admittedAt: "desc" }, take: 20 }),
    clinical ? prisma.labOrder.findMany({ where: { patientId: id }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
    prisma.invoice.findMany({ where: { patientId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const ev = [];
  for (const a of appts) ev.push({ at: a.startsAt, type: "Appointment", title: `${a.appointmentNo} with Dr. ${a.doctor.staff.firstName} ${a.doctor.staff.lastName}`, status: a.status, href: `/appointments/${a.id}` });
  for (const e of encs) ev.push({ at: e.startedAt, type: "Encounter", title: `${e.encounterNo}${e.diagnoses[0] ? ` — ${e.diagnoses[0].description}` : ""}`, status: e.status, href: `/consultations/${e.id}` });
  for (const a of adms) ev.push({ at: a.admittedAt, type: "Admission", title: `${a.admissionNo} — ${a.reason}`, status: a.status, href: `/admissions/${a.id}` });
  for (const l of labs) ev.push({ at: l.createdAt, type: "Lab order", title: l.orderNo, status: l.status, href: `/laboratory/${l.id}` });
  for (const i of invs) ev.push({ at: i.createdAt, type: "Invoice", title: i.invoiceNo, status: i.status, href: `/billing/${i.id}` });
  return ev.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 60);
}
