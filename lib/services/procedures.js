import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState, badRequest } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { getHospital } from "@/lib/services/settings";
import { advisoryLock } from "@/lib/services/admissions";
import { zonedToUtc, dayRangeUtc, formatTime } from "@/lib/utils/time";
import { findScheduleConflicts, PROCEDURE_ACTIVE_STATUSES, procedureStartBlocker, CHECKLIST_KEYS } from "@/lib/validation/procedures";

const patientSelect = { id: true, mrn: true, firstName: true, lastName: true, sex: true, dateOfBirth: true };

export async function surgeonMap(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const docs = await prisma.doctorProfile.findMany({ where: { id: { in: unique } }, select: { id: true, specialty: true, staff: { select: { firstName: true, lastName: true } } } });
  return Object.fromEntries(docs.map((d) => [d.id, { id: d.id, name: `Dr. ${d.staff.firstName} ${d.staff.lastName}`, specialty: d.specialty }]));
}

async function withSurgeons(rows) {
  const map = await surgeonMap(rows.map((r) => r.surgeonId));
  return rows.map((r) => ({ ...r, surgeon: map[r.surgeonId] || { id: r.surgeonId, name: "Unknown surgeon" } }));
}

// ── Theatres ────────────────────────────────────────────

export async function listTheatres({ includeInactive = true } = {}) {
  const now = new Date();
  const rows = await prisma.operatingTheatre.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { _count: { select: { procedures: { where: { status: { in: PROCEDURE_ACTIVE_STATUSES }, scheduledEnd: { gte: now } } } } } },
  });
  return rows.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive, upcoming: t._count.procedures }));
}

export async function createTheatre({ name }, session, ip) {
  const dup = await prisma.operatingTheatre.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (dup) throw conflict("A theatre with this name already exists.", { name: "Name already in use" });
  return prisma.$transaction(async (tx) => {
    const t = await tx.operatingTheatre.create({ data: { name } });
    await audit({ userId: session.user.id, action: "theatre.create", entityType: "OperatingTheatre", entityId: t.id, metadata: { name }, ipAddress: ip }, tx);
    return t;
  });
}

export async function updateTheatre(id, input, session, ip) {
  const t = await prisma.operatingTheatre.findUnique({ where: { id } });
  if (!t) throw notFound();
  if (input.name && input.name.toLowerCase() !== t.name.toLowerCase()) {
    const dup = await prisma.operatingTheatre.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, id: { not: id } }, select: { id: true } });
    if (dup) throw conflict("A theatre with this name already exists.", { name: "Name already in use" });
  }
  return prisma.$transaction(async (tx) => {
    if (input.isActive === false && t.isActive) {
      await advisoryLock(tx, "theatre", id);
      const upcoming = await tx.procedure.count({ where: { theatreId: id, status: { in: PROCEDURE_ACTIVE_STATUSES }, scheduledEnd: { gte: new Date() } } });
      if (upcoming) throw invalidState(`${upcoming} upcoming procedure(s) are booked in this theatre. Reschedule or cancel them before deactivating.`);
    }
    const data = { ...(input.name ? { name: input.name } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
    const r = await tx.operatingTheatre.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: input.isActive === false ? "theatre.deactivate" : input.isActive === true && !t.isActive ? "theatre.activate" : "theatre.update", entityType: "OperatingTheatre", entityId: id, metadata: { fields: Object.keys(data) }, ipAddress: ip }, tx);
    return r;
  });
}

// ── Scheduling ──────────────────────────────────────────

function describeConflicts(c, theatreName, tz) {
  const fmt = (p) => `${p.procedureNo} ${formatTime(p.scheduledStart, tz)}–${formatTime(p.scheduledEnd, tz)}`;
  const fields = {};
  if (c.theatre.length) fields.theatreId = `${theatreName} is booked: ${c.theatre.map(fmt).join(", ")}`;
  if (c.surgeon.length) fields.surgeonId = `Surgeon is already booked: ${c.surgeon.map(fmt).join(", ")}`;
  return fields;
}

async function validateRefs(input, { requirePatient = true } = {}) {
  const [patient, surgeon, theatre] = await Promise.all([
    requirePatient ? prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, status: true } }) : null,
    prisma.doctorProfile.findUnique({ where: { id: input.surgeonId }, select: { id: true, staff: { select: { employmentStatus: true } } } }),
    prisma.operatingTheatre.findUnique({ where: { id: input.theatreId }, select: { id: true, name: true, isActive: true } }),
  ]);
  if (requirePatient && (!patient || patient.status !== "ACTIVE")) throw badRequest("Select an active patient.", { patientId: "Select an active patient" });
  if (!surgeon || surgeon.staff.employmentStatus !== "ACTIVE") throw badRequest("Choose an active surgeon.", { surgeonId: "Choose an active surgeon" });
  if (!theatre || !theatre.isActive) throw badRequest("Choose an active theatre.", { theatreId: "Choose an active theatre" });
  return { theatre };
}

/**
 * Inside a transaction: lock the theatre and the surgeon (fixed order ⇒ no deadlocks), then check
 * for overlapping SCHEDULED / IN_PROGRESS bookings. Throws 409 with per-field details on a clash.
 */
async function assertSlotFree(tx, candidate, theatreName, tz) {
  await advisoryLock(tx, "theatre", candidate.theatreId);
  await advisoryLock(tx, "surgeon", candidate.surgeonId);
  const existing = await tx.procedure.findMany({
    where: {
      status: { in: PROCEDURE_ACTIVE_STATUSES },
      OR: [{ theatreId: candidate.theatreId }, { surgeonId: candidate.surgeonId }],
      scheduledStart: { lt: candidate.scheduledEnd },
      scheduledEnd: { gt: candidate.scheduledStart },
      ...(candidate.id ? { id: { not: candidate.id } } : {}),
    },
    select: { id: true, procedureNo: true, theatreId: true, surgeonId: true, status: true, scheduledStart: true, scheduledEnd: true },
  });
  const c = findScheduleConflicts(candidate, existing);
  if (c.any) throw conflict("This slot clashes with another booking.", describeConflicts(c, theatreName, tz));
}

function slot(input, tz) {
  const scheduledStart = zonedToUtc(input.date, input.startTime, tz);
  const scheduledEnd = zonedToUtc(input.date, input.endTime, tz);
  if (scheduledEnd <= scheduledStart) throw badRequest("End time must be after the start time.", { endTime: "End time must be after the start time" });
  if (scheduledStart.getTime() < Date.now() - 15 * 60000) throw badRequest("Procedures cannot be scheduled in the past.", { startTime: "Start time is in the past" });
  return { scheduledStart, scheduledEnd };
}

export async function scheduleProcedure(input, session, ip) {
  const h = await getHospital();
  const { theatre } = await validateRefs(input);
  const { scheduledStart, scheduledEnd } = slot(input, h.timezone);
  return prisma.$transaction(async (tx) => {
    await assertSlotFree(tx, { theatreId: input.theatreId, surgeonId: input.surgeonId, scheduledStart, scheduledEnd }, theatre.name, h.timezone);
    const procedureNo = await newId(tx, "procedure");
    const p = await tx.procedure.create({
      data: { procedureNo, patientId: input.patientId, theatreId: input.theatreId, surgeonId: input.surgeonId, name: input.name, scheduledStart, scheduledEnd, charge: input.charge, notes: input.notes ?? null },
    });
    await audit({ userId: session.user.id, action: "procedure.schedule", entityType: "Procedure", entityId: p.id, metadata: { procedureNo, patientId: input.patientId, theatreId: input.theatreId, surgeonId: input.surgeonId }, ipAddress: ip }, tx);
    return p;
  });
}

export async function updateProcedure(id, input, session, ip) {
  const h = await getHospital();
  const existing = await prisma.procedure.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (existing.status !== "SCHEDULED") throw invalidState("Only scheduled procedures can be edited.");
  if (input.patientId !== existing.patientId) throw badRequest("The patient of a booked procedure cannot be changed. Cancel and book a new procedure instead.", { patientId: "Patient cannot be changed" });
  const { theatre } = await validateRefs(input, { requirePatient: false });
  const { scheduledStart, scheduledEnd } = slot(input, h.timezone);
  const data = { theatreId: input.theatreId, surgeonId: input.surgeonId, name: input.name, scheduledStart, scheduledEnd, charge: input.charge, notes: input.notes ?? null };
  const changed = Object.keys(data).filter((k) => String(existing[k] instanceof Date ? existing[k].toISOString() : existing[k] ?? "") !== String(data[k] instanceof Date ? data[k].toISOString() : data[k] ?? ""));
  // Any change to what/when/where/who invalidates the safety checklist.
  const resetChecklist = changed.some((k) => ["theatreId", "surgeonId", "name", "scheduledStart", "scheduledEnd"].includes(k));
  return prisma.$transaction(async (tx) => {
    await assertSlotFree(tx, { id, theatreId: input.theatreId, surgeonId: input.surgeonId, scheduledStart, scheduledEnd }, theatre.name, h.timezone);
    const r = await tx.procedure.updateMany({ where: { id, status: "SCHEDULED" }, data: { ...data, ...(resetChecklist ? { checklistComplete: false } : {}) } });
    if (r.count === 0) throw conflict("The procedure was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "procedure.update", entityType: "Procedure", entityId: id, metadata: { fields: changed, checklistReset: resetChecklist && existing.checklistComplete }, ipAddress: ip }, tx);
    return { id };
  });
}

export async function confirmChecklist(id, session, ip) {
  const p = await prisma.procedure.findUnique({ where: { id }, select: { id: true, status: true, checklistComplete: true } });
  if (!p) throw notFound();
  if (p.status !== "SCHEDULED") throw invalidState("The checklist can only be confirmed before the procedure starts.");
  if (p.checklistComplete) throw invalidState("The checklist has already been confirmed.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.procedure.updateMany({ where: { id, status: "SCHEDULED", checklistComplete: false }, data: { checklistComplete: true } });
    if (r.count === 0) throw conflict("The procedure was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "procedure.checklist", entityType: "Procedure", entityId: id, metadata: { items: CHECKLIST_KEYS, confirmedById: session.user.id, confirmedByName: session.user.name }, ipAddress: ip }, tx);
    return { id, checklistComplete: true };
  });
}

export async function changeProcedureStatus(id, { status, postOpNotes, reason }, session, ip) {
  const p = await prisma.procedure.findUnique({ where: { id }, select: { id: true, status: true, checklistComplete: true } });
  if (!p) throw notFound();
  let where, data;
  if (status === "IN_PROGRESS") {
    const blocker = procedureStartBlocker(p);
    if (blocker) throw invalidState(blocker);
    where = { id, status: "SCHEDULED", checklistComplete: true };
    data = { status };
  } else if (status === "COMPLETED") {
    if (p.status !== "IN_PROGRESS") throw invalidState("Only procedures in progress can be completed.");
    where = { id, status: "IN_PROGRESS" };
    data = { status, postOpNotes };
  } else {
    if (!PROCEDURE_ACTIVE_STATUSES.includes(p.status)) throw invalidState("This procedure is already closed.");
    where = { id, status: p.status };
    data = { status };
  }
  return prisma.$transaction(async (tx) => {
    const r = await tx.procedure.updateMany({ where, data });
    if (r.count === 0) throw conflict("The procedure was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "procedure.status", entityType: "Procedure", entityId: id, metadata: { from: p.status, to: status, reason: status === "CANCELLED" ? reason : undefined }, ipAddress: ip }, tx);
    return { id, status };
  });
}

export async function updateProcedureNotes(id, { notes }, session, ip) {
  const p = await prisma.procedure.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!p) throw notFound();
  if (!PROCEDURE_ACTIVE_STATUSES.includes(p.status)) throw invalidState("Notes can only be edited before the procedure is closed.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.procedure.updateMany({ where: { id, status: { in: PROCEDURE_ACTIVE_STATUSES } }, data: { notes: notes ?? null } });
    if (r.count === 0) throw conflict("The procedure was closed by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "procedure.notes", entityType: "Procedure", entityId: id, metadata: { fields: ["notes"] }, ipAddress: ip }, tx);
    return { id };
  });
}

// ── Queries ─────────────────────────────────────────────

export async function getProcedure(id) {
  const p = await prisma.procedure.findUnique({
    where: { id },
    include: {
      theatre: true,
      patient: { select: { ...patientSelect, bloodGroup: true, medicalAlerts: true, allergies: { where: { isActive: true }, select: { id: true, substance: true, reaction: true, severity: true } } } },
    },
  });
  if (!p) return null;
  const [withS] = await withSurgeons([p]);
  return withS;
}

export async function getProcedureActivity(id) {
  return prisma.auditLog.findMany({ where: { entityType: "Procedure", entityId: id, action: { not: "procedure.view" } }, orderBy: { createdAt: "asc" }, take: 100, include: { user: { select: { name: true } } } });
}

function searchWhere(q) {
  if (!q) return {};
  const ci = (v) => ({ contains: v, mode: "insensitive" });
  return { OR: [{ procedureNo: ci(q) }, { name: ci(q) }, { patient: { OR: [{ mrn: ci(q) }, { firstName: ci(q) }, { lastName: ci(q) }] } }] };
}

export async function listDaySchedule(date, { theatreId, status, q } = {}, tz) {
  const [start, end] = dayRangeUtc(date, tz);
  const rows = await prisma.procedure.findMany({
    where: {
      ...searchWhere(q),
      scheduledStart: { lt: end }, scheduledEnd: { gt: start },
      ...(theatreId ? { theatreId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { scheduledStart: "asc" },
    include: { patient: { select: patientSelect }, theatre: { select: { id: true, name: true, isActive: true } } },
  });
  return withSurgeons(rows);
}

const SORTABLE = { scheduledStart: "scheduledStart", procedureNo: "procedureNo", name: "name", createdAt: "createdAt" };

export async function listProcedures({ q, page, pageSize, sort, dir, status, from, to, theatreId }, tz) {
  const where = { ...searchWhere(q), ...(status ? { status } : {}), ...(theatreId ? { theatreId } : {}) };
  if (from || to) {
    where.scheduledStart = {};
    if (from) where.scheduledStart.gte = dayRangeUtc(from, tz)[0];
    if (to) where.scheduledStart.lt = dayRangeUtc(to, tz)[1];
  }
  const [total, rows] = await Promise.all([
    prisma.procedure.count({ where }),
    prisma.procedure.findMany({
      where, orderBy: [{ [SORTABLE[sort] || "scheduledStart"]: dir }], skip: (page - 1) * pageSize, take: pageSize,
      include: { patient: { select: patientSelect }, theatre: { select: { id: true, name: true } } },
    }),
  ]);
  return { rows: await withSurgeons(rows), meta: pageMeta(total, page, pageSize) };
}
