import "server-only";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState, badRequest } from "@/lib/errors";
import { canChangeBedStatus, occupancyStats } from "@/lib/validation/inpatient";
import { getHospital } from "@/lib/services/settings";

const bedInclude = {
  assignments: {
    where: { endedAt: null },
    take: 1,
    select: {
      startedAt: true,
      admission: { select: { id: true, admissionNo: true, status: true, admittedAt: true, patient: { select: { id: true, mrn: true, firstName: true, lastName: true, sex: true } } } },
    },
  },
};

async function defaultFacilityId(db = prisma) {
  const h = await getHospital();
  const f = await db.facility.findFirst({ where: { isActive: true, ...(h.id ? { hospitalId: h.id } : {}) }, orderBy: { code: "asc" }, select: { id: true } });
  if (!f) throw invalidState("No active facility is configured. Add a facility in settings first.");
  return f.id;
}

/** Bed board: wards with beds, the current occupant of each occupied bed, and occupancy figures. */
export async function getBedBoard({ type, q, includeInactive = false } = {}) {
  const where = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(type ? { type } : {}),
  };
  const wards = await prisma.ward.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { department: { select: { id: true, name: true } }, beds: { orderBy: { label: "asc" }, include: bedInclude } },
  });
  // Reasons for out-of-service beds live in the audit trail (the schema has no column for them).
  const oosIds = wards.flatMap((w) => w.beds.filter((b) => b.status === "OUT_OF_SERVICE").map((b) => b.id));
  const reasons = {};
  if (oosIds.length) {
    const logs = await prisma.auditLog.findMany({ where: { entityType: "Bed", entityId: { in: oosIds }, action: "bed.status" }, orderBy: { createdAt: "desc" }, select: { entityId: true, metadata: true } });
    for (const l of logs) if (!(l.entityId in reasons) && l.metadata?.to === "OUT_OF_SERVICE") reasons[l.entityId] = l.metadata?.reason || null;
  }
  const term = q?.trim().toLowerCase();
  const out = wards.map((w) => {
    const beds = w.beds.map((b) => {
      const a = b.status === "OCCUPIED" ? b.assignments[0]?.admission ?? null : null;
      return { id: b.id, label: b.label, status: b.status, version: b.version, admission: a, outOfServiceReason: reasons[b.id] ?? null };
    });
    return {
      id: w.id, name: w.name, code: w.code, type: w.type, dailyRate: w.dailyRate, isActive: w.isActive, department: w.department,
      beds: term ? beds.filter((b) => b.label.toLowerCase().includes(term) || (b.admission && `${b.admission.patient.firstName} ${b.admission.patient.lastName} ${b.admission.patient.mrn} ${b.admission.admissionNo}`.toLowerCase().includes(term)) || w.name.toLowerCase().includes(term) || w.code.toLowerCase().includes(term)) : beds,
      stats: occupancyStats(w.beds),
    };
  }).filter((w) => !term || w.beds.length > 0);
  const overall = occupancyStats(wards.filter((w) => w.isActive).flatMap((w) => w.beds));
  return { wards: out, overall };
}

export async function getWard(id) {
  const w = await prisma.ward.findUnique({
    where: { id },
    include: { department: { select: { id: true, name: true } }, facility: { select: { id: true, name: true } }, beds: { orderBy: { label: "asc" }, include: bedInclude } },
  });
  if (!w) return null;
  return { ...w, stats: occupancyStats(w.beds) };
}

export async function listWardOptions() {
  const wards = await prisma.ward.findMany({
    where: { isActive: true }, orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, type: true, dailyRate: true, _count: { select: { beds: { where: { status: "AVAILABLE" } } } } },
  });
  return wards.map((w) => ({ id: w.id, name: w.name, code: w.code, type: w.type, dailyRate: w.dailyRate, available: w._count.beds }));
}

export async function listBeds({ wardId, status }) {
  return prisma.bed.findMany({
    where: { ...(wardId ? { wardId } : {}), ...(status ? { status } : {}), ward: { isActive: true } },
    orderBy: [{ ward: { name: "asc" } }, { label: "asc" }],
    select: { id: true, label: true, status: true, wardId: true, ward: { select: { name: true, code: true, type: true, dailyRate: true } } },
    take: 500,
  });
}

async function assertDepartment(departmentId) {
  if (!departmentId) return;
  const d = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, isActive: true } });
  if (!d || !d.isActive) throw badRequest("Choose a valid department.", { departmentId: "Choose a valid department" });
}

export async function createWard(input, session, ip) {
  await assertDepartment(input.departmentId);
  const dup = await prisma.ward.findUnique({ where: { code: input.code }, select: { id: true } });
  if (dup) throw conflict("A ward with this code already exists.", { code: "Code already in use" });
  const facilityId = await defaultFacilityId();
  return prisma.$transaction(async (tx) => {
    const w = await tx.ward.create({
      data: { facilityId, name: input.name, code: input.code, type: input.type, dailyRate: input.dailyRate, departmentId: input.departmentId ?? null, isActive: input.isActive ?? true },
    });
    await audit({ userId: session.user.id, action: "ward.create", entityType: "Ward", entityId: w.id, metadata: { code: w.code, type: w.type }, ipAddress: ip }, tx);
    return w;
  });
}

export async function updateWard(id, input, session, ip) {
  const existing = await prisma.ward.findUnique({ where: { id } });
  if (!existing) throw notFound();
  await assertDepartment(input.departmentId);
  if (input.code !== existing.code) {
    const dup = await prisma.ward.findUnique({ where: { code: input.code }, select: { id: true } });
    if (dup) throw conflict("A ward with this code already exists.", { code: "Code already in use" });
  }
  if (existing.isActive && input.isActive === false) {
    const occupied = await prisma.bed.count({ where: { wardId: id, status: "OCCUPIED" } });
    if (occupied) throw invalidState(`This ward has ${occupied} occupied bed(s). Transfer or discharge patients before deactivating it.`);
  }
  const data = { name: input.name, code: input.code, type: input.type, dailyRate: input.dailyRate, departmentId: input.departmentId ?? null, isActive: input.isActive ?? existing.isActive };
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  return prisma.$transaction(async (tx) => {
    const w = await tx.ward.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: "ward.update", entityType: "Ward", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return w;
  });
}

export async function addBeds(wardId, labels, session, ip) {
  const ward = await prisma.ward.findUnique({ where: { id: wardId }, select: { id: true, code: true, isActive: true } });
  if (!ward) throw notFound();
  const existing = await prisma.bed.findMany({ where: { wardId, label: { in: labels, mode: "insensitive" } }, select: { label: true } });
  if (existing.length) throw conflict(`Bed label already exists in this ward: ${existing.map((b) => b.label).join(", ")}`, { labels: "Bed labels must be unique within the ward" });
  return prisma.$transaction(async (tx) => {
    const r = await tx.bed.createMany({ data: labels.map((label) => ({ wardId, label, status: "AVAILABLE" })) });
    await audit({ userId: session.user.id, action: "bed.create", entityType: "Ward", entityId: wardId, metadata: { labels, count: r.count }, ipAddress: ip }, tx);
    return { created: r.count };
  });
}

/**
 * Manual status change on a non-occupied bed. Race-safe: the update only applies if the bed
 * is still in the status the user saw and has no occupant.
 */
export async function changeBedStatus(bedId, { status, reason }, session, ip) {
  const bed = await prisma.bed.findUnique({ where: { id: bedId }, select: { id: true, status: true, label: true, wardId: true, currentAdmissionId: true } });
  if (!bed) throw notFound();
  if (bed.status === "OCCUPIED") throw invalidState("Occupied beds change status only through discharge or transfer.");
  if (!canChangeBedStatus(bed.status, status)) throw invalidState(`A bed cannot move from ${bed.status.toLowerCase().replace(/_/g, " ")} to ${status.toLowerCase().replace(/_/g, " ")}.`);
  return prisma.$transaction(async (tx) => {
    const r = await tx.bed.updateMany({
      where: { id: bedId, status: bed.status, currentAdmissionId: null },
      data: { status, version: { increment: 1 } },
    });
    if (r.count === 0) throw conflict("The bed was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "bed.status", entityType: "Bed", entityId: bedId, metadata: { from: bed.status, to: status, reason: reason || undefined, wardId: bed.wardId, label: bed.label }, ipAddress: ip }, tx);
    return { id: bedId, status };
  });
}

export async function listDepartmentOptions() {
  return prisma.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
