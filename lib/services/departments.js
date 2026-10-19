import "server-only";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { getHospital } from "@/lib/services/settings";

const ci = (v) => ({ contains: v, mode: "insensitive" });
/** Doctors who still practise: employment not suspended/terminated. */
const ACTIVE_DOCTOR = { staff: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } } };

const COUNTS = {
  _count: {
    select: {
      staff: { where: { employmentStatus: { not: "TERMINATED" } } },
      doctors: { where: ACTIVE_DOCTOR },
      wards: { where: { isActive: true } },
    },
  },
};

const SORT = { name: "name", code: "code", createdAt: "createdAt" };

export async function listDepartments({ q, page = 1, pageSize = 20, sort = "name", dir = "asc", status }) {
  const where = {};
  if (q) where.OR = [{ name: ci(q) }, { code: ci(q) }, { description: ci(q) }];
  if (status === "ACTIVE") where.isActive = true;
  if (status === "INACTIVE") where.isActive = false;
  const [total, rows] = await Promise.all([
    prisma.department.count({ where }),
    prisma.department.findMany({
      where, orderBy: { [SORT[sort] || "name"]: dir === "desc" ? "desc" : "asc" }, skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, name: true, code: true, description: true, isClinical: true, isActive: true, createdAt: true, ...COUNTS },
    }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

/** Lightweight list for pickers (GET /api/departments contract). */
export async function listDepartmentOptions({ includeInactive = false, clinicalOnly = false } = {}) {
  return prisma.department.findMany({
    where: { ...(includeInactive ? {} : { isActive: true }), ...(clinicalOnly ? { isClinical: true } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, isClinical: true, isActive: true },
  });
}

export async function getDepartment(id) {
  return prisma.department.findUnique({ where: { id }, select: { id: true, name: true, code: true, description: true, isClinical: true, isActive: true, createdAt: true, updatedAt: true, ...COUNTS } });
}

async function assertCodeFree(code, excludeId) {
  const dup = await prisma.department.findFirst({ where: { code: { equals: code, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
  if (dup) throw conflict("This department code is already in use.", { code: "Code already in use" });
}

export async function createDepartment(input, session, ip) {
  const h = await getHospital();
  if (!h.id) throw invalidState("The hospital profile is not configured.");
  await assertCodeFree(input.code);
  return prisma.$transaction(async (tx) => {
    const d = await tx.department.create({ data: { hospitalId: h.id, name: input.name, code: input.code, description: input.description ?? null, isClinical: input.isClinical !== false } });
    await audit({ userId: session.user.id, action: "department.create", entityType: "Department", entityId: d.id, metadata: { code: d.code }, ipAddress: ip }, tx);
    return d;
  });
}

export async function updateDepartment(id, input, session, ip) {
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (input.code !== existing.code) await assertCodeFree(input.code, id);
  const data = { name: input.name, code: input.code, description: input.description ?? null, isClinical: input.isClinical !== false };
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  return prisma.$transaction(async (tx) => {
    const d = await tx.department.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: "department.update", entityType: "Department", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return d;
  });
}

/** Deactivation is blocked while the department still has practising doctors. */
export async function setDepartmentActive(id, isActive, reason, session, ip) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`SELECT "id", "isActive" FROM "Department" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked.length) throw notFound();
    if (locked[0].isActive === isActive) throw invalidState(isActive ? "Department is already active." : "Department is already inactive.");
    if (!isActive) {
      const doctors = await tx.doctorProfile.count({ where: { departmentId: id, ...ACTIVE_DOCTOR } });
      if (doctors > 0) throw invalidState(`This department has ${doctors} active doctor${doctors === 1 ? "" : "s"}. Move them to another department (or change their employment status) before deactivating.`);
    }
    const d = await tx.department.update({ where: { id }, data: { isActive } });
    await audit({ userId: session.user.id, action: isActive ? "department.activate" : "department.deactivate", entityType: "Department", entityId: id, metadata: reason ? { reason } : undefined, ipAddress: ip }, tx);
    return d;
  });
}
