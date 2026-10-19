import "server-only";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState, badRequest } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { canChangeAmbulanceStatus, canDispatchTransition, dispatchReleasesAmbulance, ER_ACTIVE_STATUSES } from "@/lib/validation/emergency";
import { dayRangeUtc } from "@/lib/utils/time";

export async function listAmbulances({ q, status } = {}) {
  const ci = (v) => ({ contains: v, mode: "insensitive" });
  const where = {
    ...(q ? { OR: [{ vehicleNo: ci(q) }, { driverName: ci(q) }, { driverPhone: { contains: q } }] } : {}),
    ...(status ? { status } : {}),
  };
  return prisma.ambulance.findMany({
    where, orderBy: { vehicleNo: "asc" },
    include: { dispatches: { where: { status: { in: ["DISPATCHED", "ON_SCENE", "TRANSPORTING"] } }, take: 1, orderBy: { dispatchedAt: "desc" }, select: { id: true, status: true, destination: true, dispatchedAt: true } } },
  });
}

export async function fleetSummary() {
  const rows = await prisma.ambulance.groupBy({ by: ["status"], _count: { _all: true } });
  const out = { AVAILABLE: 0, DISPATCHED: 0, MAINTENANCE: 0, total: 0 };
  for (const r of rows) { out[r.status] = r._count._all; out.total += r._count._all; }
  return out;
}

export async function createAmbulance(input, session, ip) {
  const dup = await prisma.ambulance.findUnique({ where: { vehicleNo: input.vehicleNo }, select: { id: true } });
  if (dup) throw conflict("A vehicle with this number already exists.", { vehicleNo: "Vehicle number already registered" });
  return prisma.$transaction(async (tx) => {
    const a = await tx.ambulance.create({ data: { vehicleNo: input.vehicleNo, type: input.type, driverName: input.driverName ?? null, driverPhone: input.driverPhone ?? null, status: "AVAILABLE" } });
    await audit({ userId: session.user.id, action: "ambulance.create", entityType: "Ambulance", entityId: a.id, metadata: { vehicleNo: a.vehicleNo, type: a.type }, ipAddress: ip }, tx);
    return a;
  });
}

export async function updateAmbulance(id, input, session, ip) {
  const existing = await prisma.ambulance.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (input.vehicleNo !== existing.vehicleNo) {
    const dup = await prisma.ambulance.findUnique({ where: { vehicleNo: input.vehicleNo }, select: { id: true } });
    if (dup) throw conflict("A vehicle with this number already exists.", { vehicleNo: "Vehicle number already registered" });
  }
  const data = { vehicleNo: input.vehicleNo, type: input.type, driverName: input.driverName ?? null, driverPhone: input.driverPhone ?? null };
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  return prisma.$transaction(async (tx) => {
    const a = await tx.ambulance.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: "ambulance.update", entityType: "Ambulance", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return a;
  });
}

export async function setAmbulanceStatus(id, { status }, session, ip) {
  const a = await prisma.ambulance.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!a) throw notFound();
  if (a.status === "DISPATCHED") throw invalidState("This ambulance is on a dispatch. Complete or cancel the dispatch first.");
  if (!canChangeAmbulanceStatus(a.status, status)) throw invalidState(`Ambulance is already ${a.status.toLowerCase()}.`);
  return prisma.$transaction(async (tx) => {
    const r = await tx.ambulance.updateMany({ where: { id, status: a.status }, data: { status } });
    if (r.count === 0) throw conflict("The ambulance was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "ambulance.status", entityType: "Ambulance", entityId: id, metadata: { from: a.status, to: status }, ipAddress: ip }, tx);
    return { id, status };
  });
}

export async function listDispatches({ q, page, pageSize, status, from, to }, tz) {
  const ci = (v) => ({ contains: v, mode: "insensitive" });
  const where = {
    ...(q ? { OR: [{ pickupAddress: ci(q) }, { destination: ci(q) }, { callerName: ci(q) }, { callerPhone: { contains: q } }, { ambulance: { vehicleNo: ci(q) } }, { emergencyVisit: { visitNo: ci(q) } }] } : {}),
    ...(status === "ACTIVE" ? { status: { in: ["DISPATCHED", "ON_SCENE", "TRANSPORTING"] } } : status ? { status } : {}),
  };
  if (from || to) {
    where.dispatchedAt = {};
    if (from) where.dispatchedAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.dispatchedAt.lt = dayRangeUtc(to, tz)[1];
  }
  const [total, rows] = await Promise.all([
    prisma.ambulanceDispatch.count({ where }),
    prisma.ambulanceDispatch.findMany({
      where, orderBy: { dispatchedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
      include: { ambulance: { select: { id: true, vehicleNo: true, type: true } }, emergencyVisit: { select: { id: true, visitNo: true } } },
    }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function createDispatch(input, session, ip) {
  if (input.emergencyVisitId) {
    const v = await prisma.emergencyVisit.findUnique({ where: { id: input.emergencyVisitId }, select: { id: true, status: true } });
    if (!v) throw badRequest("Choose a valid ER visit.", { emergencyVisitId: "Choose a valid ER visit" });
    if (!ER_ACTIVE_STATUSES.includes(v.status)) throw invalidState("The linked ER visit is already closed.");
  }
  return prisma.$transaction(async (tx) => {
    // Race-safe claim: only an AVAILABLE ambulance can be dispatched, and only once.
    const claimed = await tx.ambulance.updateMany({ where: { id: input.ambulanceId, status: "AVAILABLE" }, data: { status: "DISPATCHED" } });
    if (claimed.count === 0) {
      const exists = await tx.ambulance.findUnique({ where: { id: input.ambulanceId }, select: { status: true } });
      if (!exists) throw badRequest("Choose an ambulance.", { ambulanceId: "Choose an ambulance" });
      throw conflict(`That ambulance is ${exists.status === "MAINTENANCE" ? "in maintenance" : "already on a dispatch"} and cannot be dispatched.`, { ambulanceId: "Ambulance not available" });
    }
    const d = await tx.ambulanceDispatch.create({
      data: {
        ambulanceId: input.ambulanceId, emergencyVisitId: input.emergencyVisitId ?? null, pickupAddress: input.pickupAddress, destination: input.destination,
        callerName: input.callerName ?? null, callerPhone: input.callerPhone ?? null, status: "DISPATCHED", createdById: session.user.id,
      },
    });
    await audit({ userId: session.user.id, action: "ambulance.dispatch", entityType: "AmbulanceDispatch", entityId: d.id, metadata: { ambulanceId: input.ambulanceId, emergencyVisitId: input.emergencyVisitId ?? null }, ipAddress: ip }, tx);
    if (input.emergencyVisitId) {
      await audit({ userId: session.user.id, action: "emergency.ambulance_dispatched", entityType: "EmergencyVisit", entityId: input.emergencyVisitId, metadata: { dispatchId: d.id, ambulanceId: input.ambulanceId }, ipAddress: ip }, tx);
    }
    return d;
  });
}

export async function progressDispatch(id, { status, reason }, session, ip) {
  const d = await prisma.ambulanceDispatch.findUnique({ where: { id }, select: { id: true, status: true, ambulanceId: true, arrivedAt: true } });
  if (!d) throw notFound();
  if (!canDispatchTransition(d.status, status)) throw invalidState(`A dispatch that is ${d.status.toLowerCase().replace(/_/g, " ")} cannot move to ${status.toLowerCase().replace(/_/g, " ")}.`);
  const now = new Date();
  const data = { status };
  if (status === "ON_SCENE") data.arrivedAt = now;
  if (status === "COMPLETED" || status === "CANCELLED") data.completedAt = now;
  if (status === "COMPLETED" && !d.arrivedAt) data.arrivedAt = now;
  return prisma.$transaction(async (tx) => {
    const r = await tx.ambulanceDispatch.updateMany({ where: { id, status: d.status }, data });
    if (r.count === 0) throw conflict("The dispatch was updated by someone else. Refresh and try again.");
    if (dispatchReleasesAmbulance(status)) {
      await tx.ambulance.updateMany({ where: { id: d.ambulanceId, status: "DISPATCHED" }, data: { status: "AVAILABLE" } });
    }
    await audit({ userId: session.user.id, action: "ambulance.dispatch_status", entityType: "AmbulanceDispatch", entityId: id, metadata: { from: d.status, to: status, reason: reason || undefined }, ipAddress: ip }, tx);
    return { id, status };
  });
}
