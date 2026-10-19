import "server-only";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState, forbidden, badRequest } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { can } from "@/lib/auth/session";
import { notifyPermission, notifyUser } from "@/lib/services/notifications";
import { todayInTz, addDays } from "@/lib/utils/time";
import { LEAVE_STATUS, canTransitionLeave, summarizeAttendance } from "@/lib/validation/staff";
import { staffSearchWhere } from "@/lib/services/staff";

/** @db.Date columns are stored as UTC midnight. */
const dbDate = (ymd) => new Date(`${ymd}T00:00:00.000Z`);
const ymdOf = (d) => new Date(d).toISOString().slice(0, 10);

// ───────────────────────────── Attendance ─────────────────────────────

/**
 * Roster for one day: all ACTIVE / ON_LEAVE staff, plus anyone who already has a record that day.
 * Approved leave covering the date is surfaced so HR can mark ON_LEAVE consistently.
 */
export async function getAttendanceSheet(date, { departmentId, q } = {}) {
  const d = dbDate(date);
  const and = [{ OR: [{ employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } }, { attendance: { some: { date: d } } }] }];
  if (departmentId) and.push({ departmentId });
  if (q) and.push(staffSearchWhere(q));
  const staff = await prisma.staff.findMany({
    where: { AND: and },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 2000,
    select: {
      id: true, employeeNo: true, firstName: true, lastName: true, position: true, employmentStatus: true,
      department: { select: { name: true } },
      attendance: { where: { date: d }, select: { id: true, status: true, note: true } },
      leaveRequests: { where: { status: "APPROVED", startDate: { lte: d }, endDate: { gte: d } }, select: { id: true, type: true }, take: 1 },
    },
  });
  const rows = staff.map((s) => ({
    staffId: s.id,
    employeeNo: s.employeeNo,
    name: `${s.firstName} ${s.lastName}`,
    position: s.position,
    department: s.department?.name ?? null,
    employmentStatus: s.employmentStatus,
    status: s.attendance[0]?.status ?? null,
    note: s.attendance[0]?.note ?? "",
    approvedLeave: s.leaveRequests[0]?.type ?? null,
  }));
  return { date, rows, summary: summarizeAttendance(rows) };
}

export async function saveAttendance({ date, entries }, tz, session, ip) {
  if (date > todayInTz(tz)) throw invalidState("Attendance cannot be recorded for a future date.");
  const ids = entries.map((e) => e.staffId);
  const found = await prisma.staff.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw badRequest("One or more staff members were not found. Refresh and try again.");
  const d = dbDate(date);
  return prisma.$transaction(async (tx) => {
    for (const e of entries) {
      await tx.employeeAttendance.upsert({
        where: { staffId_date: { staffId: e.staffId, date: d } },
        create: { staffId: e.staffId, date: d, status: e.status, note: e.note ?? null },
        update: { status: e.status, note: e.note ?? null },
      });
    }
    await audit({ userId: session.user.id, action: "attendance.save", entityType: "EmployeeAttendance", entityId: null, metadata: { date, count: entries.length }, ipAddress: ip }, tx);
    return { date, saved: entries.length };
  }, { timeout: 30000 });
}

/** Last `days` days of attendance for one staff member (most recent first). */
export async function getStaffAttendance(staffId, tz, days = 30) {
  const today = todayInTz(tz);
  const from = addDays(today, -(days - 1));
  const rows = await prisma.employeeAttendance.findMany({
    where: { staffId, date: { gte: dbDate(from), lte: dbDate(today) } },
    orderBy: { date: "desc" },
    select: { id: true, date: true, status: true, note: true },
  });
  return { from, to: today, rows, summary: summarizeAttendance(rows) };
}

// ───────────────────────────── Leave ─────────────────────────────

export async function listLeave({ q, page = 1, pageSize = 20, status, staffId }) {
  const where = {};
  if (LEAVE_STATUS.includes(status)) where.status = status;
  if (staffId) where.staffId = staffId;
  if (q) where.staff = staffSearchWhere(q);
  const [total, rows] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { staff: { select: { id: true, employeeNo: true, firstName: true, lastName: true, userId: true, department: { select: { name: true } } } } },
    }),
  ]);
  return { rows: await withDecisionDetails(rows), meta: pageMeta(total, page, pageSize) };
}

/**
 * LeaveRequest has no decision-note column, so rejection/cancellation reasons live in the audit trail.
 * Attach decider names and those reasons for display.
 */
async function withDecisionDetails(rows) {
  if (!rows.length) return rows;
  const userIds = [...new Set(rows.map((r) => r.decidedById).filter(Boolean))];
  const [users, logs] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    prisma.auditLog.findMany({
      where: { entityType: "LeaveRequest", entityId: { in: rows.map((r) => r.id) }, action: { in: ["leave.reject", "leave.cancel"] } },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, action: true, metadata: true, user: { select: { name: true } } },
    }),
  ]);
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const notes = {};
  for (const l of logs) notes[l.entityId] ??= { action: l.action, reason: l.metadata?.reason ?? null, by: l.user?.name ?? null };
  return rows.map((r) => ({ ...r, decidedByName: r.decidedById ? names[r.decidedById] ?? null : null, decisionNote: notes[r.id]?.reason ?? null, cancelledBy: notes[r.id]?.action === "leave.cancel" ? notes[r.id].by : null }));
}

export async function createLeave(input, session, ip) {
  const staff = await prisma.staff.findUnique({ where: { id: input.staffId }, select: { id: true, employmentStatus: true } });
  if (!staff) throw badRequest("Choose a valid staff member.", { staffId: "Staff member not found" });
  if (staff.employmentStatus === "TERMINATED") throw invalidState("Leave cannot be filed for a terminated employee.");
  const start = dbDate(input.startDate);
  const end = dbDate(input.endDate);

  const created = await prisma.$transaction(async (tx) => {
    // Serialise filings for the same employee so overlapping requests cannot slip through concurrently.
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${staff.id} FOR UPDATE`;
    const overlap = await tx.leaveRequest.findFirst({
      where: { staffId: staff.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } },
      select: { id: true, status: true, startDate: true, endDate: true },
    });
    if (overlap) {
      throw conflict(`Overlaps an existing ${overlap.status.toLowerCase()} request (${ymdOf(overlap.startDate)} – ${ymdOf(overlap.endDate)}).`, { startDate: "Overlaps an existing leave request" });
    }
    const lr = await tx.leaveRequest.create({ data: { staffId: staff.id, type: input.type, startDate: start, endDate: end, reason: input.reason ?? null } });
    await audit({ userId: session.user.id, action: "leave.create", entityType: "LeaveRequest", entityId: lr.id, metadata: { staffId: staff.id, type: input.type, startDate: input.startDate, endDate: input.endDate }, ipAddress: ip }, tx);
    // No names, dates or reasons in the notification body.
    await notifyPermission(["hr:manage"], { category: "HR", title: "Leave request pending", body: "A staff leave request needs a decision.", link: "/staff?tab=leave&status=PENDING" }, tx);
    return lr;
  });
  return created;
}

/** approve | reject (hr:manage, never one's own request) · cancel (hr:manage or staff:manage). */
export async function actOnLeave(id, { action, reason }, tz, session, ip) {
  const lr = await prisma.leaveRequest.findUnique({ where: { id }, include: { staff: { select: { id: true, userId: true } } } });
  if (!lr) throw notFound();
  const to = { approve: "APPROVED", reject: "REJECTED", cancel: "CANCELLED" }[action];

  if (action === "approve" || action === "reject") {
    if (!can(session, "hr:manage")) throw forbidden("Approving or rejecting leave requires the hr:manage permission.");
    if (lr.staff.userId && lr.staff.userId === session.user.id) throw forbidden("You cannot decide your own leave request.");
  }
  if (!canTransitionLeave(lr.status, to)) throw invalidState(`This request is ${lr.status.toLowerCase()} and cannot be ${to.toLowerCase()}.`);
  if (action === "cancel" && lr.status === "APPROVED" && ymdOf(lr.endDate) < todayInTz(tz)) throw invalidState("This leave has already been taken and cannot be cancelled.");

  const result = await prisma.$transaction(async (tx) => {
    const data = { status: to };
    if (action !== "cancel") { data.decidedById = session.user.id; data.decidedAt = new Date(); }
    const r = await tx.leaveRequest.updateMany({ where: { id, status: lr.status }, data });
    if (!r.count) throw conflict("This request was updated by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: `leave.${action}`, entityType: "LeaveRequest", entityId: id, metadata: { staffId: lr.staffId, from: lr.status, to, ...(reason ? { reason } : {}) }, ipAddress: ip }, tx);
    if (lr.staff.userId && lr.staff.userId !== session.user.id) {
      await notifyUser(lr.staff.userId, { category: "HR", title: `Your leave request was ${to.toLowerCase()}`, body: null, link: null }, tx);
    }
    return { id, status: to };
  });
  return result;
}
