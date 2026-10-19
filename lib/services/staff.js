import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState, forbidden, badRequest } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { can } from "@/lib/auth/session";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { notifyPermission } from "@/lib/services/notifications";
import { zonedToUtc } from "@/lib/utils/time";
import {
  EMPLOYMENT_STATUS, REVOKING_STATUSES, canTransitionEmployment, findAvailabilityIssues, normalizeWindows, buildTempPassword,
} from "@/lib/validation/staff";

const ci = (v) => ({ contains: v, mode: "insensitive" });
/** Appointment statuses that still occupy a doctor's time. */
export const OPEN_APPOINTMENT_STATUSES = ["REQUESTED", "SCHEDULED", "CONFIRMED", "CHECKED_IN"];

/** Viewers allowed to see employment details and emergency contacts. */
export function isHrPrivileged(session) {
  return can(session, ["hr:read", "staff:manage"]);
}

// ───────────────────────────── Shared helpers ─────────────────────────────

async function assertDepartment(departmentId, { requireActive = true } = {}) {
  if (!departmentId) return null;
  const d = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, isActive: true } });
  if (!d) throw badRequest("Choose a valid department.", { departmentId: "Department not found" });
  if (requireActive && !d.isActive) throw invalidState("This department is inactive. Choose an active department.");
  return d;
}

function changedFields(existing, data) {
  return Object.keys(data).filter((k) => {
    const a = existing[k], b = data[k];
    const norm = (v) => {
      if (v == null) return "";
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = typeof v === "object" && typeof v.toFixed === "function" ? v.toFixed(2) : String(v);
      return /^\d+(\.\d+)?$/.test(s) ? Number(s).toFixed(2) : s; // Decimal "2500" ≡ "2500.00"
    };
    return norm(a) !== norm(b);
  });
}

function staffDataFrom(input) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email?.toLowerCase() ?? null,
    phone: input.phone ?? null,
    departmentId: input.departmentId ?? null,
    position: input.position,
    joiningDate: new Date(input.joiningDate),
    shift: input.shift ?? null,
  };
}

// ───────────────────────────── Login accounts ─────────────────────────────

/** Validates the email is free and produces a one-time temporary password + hash (hashed outside any transaction). */
async function prepareAccount(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email) throw badRequest("An email is required to create a login account.", { email: "Email is required for a login account" });
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw conflict("A user account with this email already exists.", { email: "A user account with this email already exists" });
  const password = buildTempPassword((n) => crypto.randomInt(n));
  if (validatePasswordStrength(password)) throw new Error("Generated password failed policy");
  return { email, password, passwordHash: await hashPassword(password) };
}

async function createLinkedUser(tx, staff, account, roleKey, session, ip) {
  const role = await tx.role.findUnique({ where: { key: roleKey }, select: { id: true } });
  if (!role) throw invalidState(`The ${roleKey} role is not configured.`);
  const user = await tx.user.create({
    data: {
      email: account.email,
      name: `${staff.firstName} ${staff.lastName}`,
      passwordHash: account.passwordHash,
      mustChangePassword: true,
      isActive: true,
      roles: { create: [{ roleId: role.id }] },
    },
    select: { id: true, email: true },
  });
  // Race-safe link: only attach when the staff record still has no account.
  const linked = await tx.staff.updateMany({ where: { id: staff.id, userId: null }, data: { userId: user.id } });
  if (!linked.count) throw conflict("This staff member already has a login account.");
  await audit({ userId: session.user.id, action: "user.create", entityType: "User", entityId: user.id, metadata: { roles: [roleKey], staffId: staff.id, temporaryPassword: true }, ipAddress: ip }, tx);
  return user;
}

// ───────────────────────────── Doctors ─────────────────────────────

export function doctorSearchWhere(q) {
  const term = (q || "").trim().replace(/^dr\.?\s*/i, "");
  if (!term) return {};
  const parts = term.split(/\s+/);
  const or = [
    { specialty: ci(term) },
    { licenseNumber: ci(term) },
    { staff: { firstName: ci(term) } },
    { staff: { lastName: ci(term) } },
    { staff: { employeeNo: ci(term) } },
  ];
  if (parts.length > 1) or.push({ staff: { AND: [{ firstName: ci(parts[0]) }, { lastName: ci(parts.slice(1).join(" ")) }] } });
  return { OR: or };
}

const DOCTOR_SORT = {
  name: (dir) => [{ staff: { lastName: dir } }, { staff: { firstName: dir } }],
  specialty: (dir) => [{ specialty: dir }],
  department: (dir) => [{ department: { name: dir } }],
  fee: (dir) => [{ consultationFee: dir }],
  slot: (dir) => [{ slotMinutes: dir }],
};

const DOCTOR_LIST_SELECT = {
  id: true, specialty: true, licenseNumber: true, consultationFee: true, slotMinutes: true, acceptsAppointments: true, departmentId: true,
  department: { select: { id: true, name: true, isActive: true } },
  staff: { select: { id: true, employeeNo: true, firstName: true, lastName: true, employmentStatus: true, phone: true, userId: true } },
  _count: { select: { availability: true } },
};

/**
 * status: "ACTIVE" | "INACTIVE" | an EmploymentStatus | undefined (all)
 * accepting: "yes" | "no" | undefined
 */
export async function listDoctors({ q, page = 1, pageSize = 20, sort = "name", dir = "asc", departmentId, status, accepting }) {
  const where = { ...doctorSearchWhere(q) };
  if (departmentId) where.departmentId = departmentId;
  if (status === "INACTIVE") where.staff = { employmentStatus: { not: "ACTIVE" } };
  else if (EMPLOYMENT_STATUS.includes(status)) where.staff = { employmentStatus: status };
  if (accepting === "yes") where.acceptsAppointments = true;
  if (accepting === "no") where.acceptsAppointments = false;
  const orderBy = (DOCTOR_SORT[sort] || DOCTOR_SORT.name)(dir === "desc" ? "desc" : "asc");
  const [total, rows] = await Promise.all([
    prisma.doctorProfile.count({ where }),
    prisma.doctorProfile.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: DOCTOR_LIST_SELECT }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

/** Shape used by GET /api/doctors (cross-module contract) and the DoctorSelector picker. */
export function toDoctorOption(d) {
  return {
    id: d.id,
    name: `${d.staff.firstName} ${d.staff.lastName}`,
    specialty: d.specialty,
    departmentId: d.departmentId,
    departmentName: d.department?.name ?? null,
    consultationFee: d.consultationFee.toFixed(2),
    slotMinutes: d.slotMinutes,
    staffId: d.staff.id,
    acceptsAppointments: d.acceptsAppointments,
    employmentStatus: d.staff.employmentStatus,
  };
}

export async function getDoctor(id) {
  return prisma.doctorProfile.findUnique({
    where: { id },
    include: {
      department: true,
      staff: { include: { user: { select: { id: true, email: true, isActive: true, lastLoginAt: true, mustChangePassword: true, roles: { select: { role: { select: { key: true, name: true } } } } } } } },
      availability: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] },
    },
  });
}

export async function listUpcomingExceptions(doctorId, now = new Date()) {
  return prisma.scheduleException.findMany({ where: { doctorId, endsAt: { gt: now } }, orderBy: { startsAt: "asc" }, take: 100 });
}

export async function listUpcomingAppointments(doctorId, { take = 25, now = new Date() } = {}) {
  const where = { doctorId, startsAt: { gte: now }, status: { in: OPEN_APPOINTMENT_STATUSES } };
  const [total, rows] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where, orderBy: { startsAt: "asc" }, take,
      select: { id: true, appointmentNo: true, startsAt: true, endsAt: true, status: true, type: true, patient: { select: { id: true, mrn: true, firstName: true, lastName: true } } },
    }),
  ]);
  return { total, rows };
}

async function assertLicenseFree(licenseNumber, excludeDoctorId) {
  const dup = await prisma.doctorProfile.findFirst({
    where: { licenseNumber: { equals: licenseNumber, mode: "insensitive" }, ...(excludeDoctorId ? { id: { not: excludeDoctorId } } : {}) },
    select: { id: true },
  });
  if (dup) throw conflict("This license number is already registered to another doctor.", { licenseNumber: "License number already registered" });
}

function doctorDataFrom(input) {
  return {
    departmentId: input.departmentId,
    specialty: input.specialty,
    qualifications: input.qualifications ?? null,
    licenseNumber: input.licenseNumber,
    consultationFee: input.consultationFee,
    slotMinutes: input.slotMinutes,
    acceptsAppointments: input.acceptsAppointments !== false,
  };
}

export async function createDoctor(input, session, ip) {
  if (input.createAccount && !can(session, "users:manage")) throw forbidden("Creating login accounts requires the users:manage permission.");
  await assertDepartment(input.departmentId);
  await assertLicenseFree(input.licenseNumber);
  const account = input.createAccount ? await prepareAccount(input.email) : null;

  return prisma.$transaction(async (tx) => {
    const staff = await tx.staff.create({
      data: { ...staffDataFrom(input), employeeNo: await newId(tx, "employee"), employmentStatus: "ACTIVE" },
    });
    const doctor = await tx.doctorProfile.create({ data: { ...doctorDataFrom(input), staffId: staff.id } });
    await audit({ userId: session.user.id, action: "doctor.create", entityType: "DoctorProfile", entityId: doctor.id, metadata: { staffId: staff.id, employeeNo: staff.employeeNo, account: !!account }, ipAddress: ip }, tx);
    let user = null;
    if (account) user = await createLinkedUser(tx, staff, account, "DOCTOR", session, ip);
    return {
      id: doctor.id,
      staffId: staff.id,
      employeeNo: staff.employeeNo,
      // Shown once in the UI; never stored in plain text or logged.
      account: user ? { email: user.email, temporaryPassword: account.password } : null,
    };
  });
}

export async function updateDoctor(id, input, session, ip) {
  const existing = await prisma.doctorProfile.findUnique({ where: { id }, include: { staff: true } });
  if (!existing) throw notFound();
  if (input.departmentId !== existing.departmentId) await assertDepartment(input.departmentId);
  if (input.licenseNumber.toUpperCase() !== existing.licenseNumber.toUpperCase()) await assertLicenseFree(input.licenseNumber, id);

  const staffData = staffDataFrom(input);
  const docData = doctorDataFrom(input);
  const changed = [...changedFields(existing.staff, staffData), ...changedFields(existing, docData)];
  const nameChanged = staffData.firstName !== existing.staff.firstName || staffData.lastName !== existing.staff.lastName;

  return prisma.$transaction(async (tx) => {
    await tx.staff.update({ where: { id: existing.staffId }, data: staffData });
    const doc = await tx.doctorProfile.update({ where: { id }, data: docData });
    if (nameChanged && existing.staff.userId) await tx.user.update({ where: { id: existing.staff.userId }, data: { name: `${staffData.firstName} ${staffData.lastName}` } });
    await audit({ userId: session.user.id, action: "doctor.update", entityType: "DoctorProfile", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return { id: doc.id, staffId: existing.staffId };
  });
}

/** Creates a DOCTOR login for an existing doctor that has none. Returns the one-time temporary password. */
export async function createDoctorAccount(doctorId, session, ip) {
  const doc = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, include: { staff: true } });
  if (!doc) throw notFound();
  if (doc.staff.userId) throw invalidState("This doctor already has a login account.");
  if (REVOKING_STATUSES.includes(doc.staff.employmentStatus)) throw invalidState("Reactivate the staff member before creating a login account.");
  if (!doc.staff.email) throw invalidState("Add an email address to the doctor's profile before creating a login account.");
  const account = await prepareAccount(doc.staff.email);
  return prisma.$transaction(async (tx) => {
    const user = await createLinkedUser(tx, doc.staff, account, "DOCTOR", session, ip);
    return { email: user.email, temporaryPassword: account.password };
  });
}

// ───────────────────────────── Availability & exceptions ─────────────────────────────

export async function setAvailability(doctorId, windows, session, ip) {
  const issues = findAvailabilityIssues(windows);
  if (issues.length) {
    const fields = Object.fromEntries(issues.map((i) => [`windows.${i.index}.${i.field}`, i.message]));
    throw badRequest(issues[0].message, fields);
  }
  const rows = normalizeWindows(windows);
  return prisma.$transaction(async (tx) => {
    // Row lock serialises concurrent editors so two replacements can never interleave.
    const locked = await tx.$queryRaw`SELECT "id" FROM "DoctorProfile" WHERE "id" = ${doctorId} FOR UPDATE`;
    if (!locked.length) throw notFound();
    const before = await tx.doctorAvailability.count({ where: { doctorId } });
    await tx.doctorAvailability.deleteMany({ where: { doctorId } });
    if (rows.length) await tx.doctorAvailability.createMany({ data: rows.map((r) => ({ doctorId, ...r })) });
    await audit({ userId: session.user.id, action: "doctor.availability_update", entityType: "DoctorProfile", entityId: doctorId, metadata: { before, after: rows.length }, ipAddress: ip }, tx);
    return tx.doctorAvailability.findMany({ where: { doctorId }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] });
  });
}

export async function addScheduleException(doctorId, input, tz, session, ip) {
  const doc = await prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { id: true } });
  if (!doc) throw notFound();
  const startsAt = zonedToUtc(input.startDate, input.startTime, tz);
  const endsAt = zonedToUtc(input.endDate, input.endTime, tz);
  if (endsAt <= startsAt) throw badRequest("End must be after start.", { endTime: "End must be after start" });
  if (endsAt <= new Date()) throw invalidState("This period has already ended. Exceptions are for current or future time.");

  const ex = await prisma.$transaction(async (tx) => {
    const row = await tx.scheduleException.create({ data: { doctorId, startsAt, endsAt, reason: input.reason } });
    await audit({ userId: session.user.id, action: "doctor.exception_create", entityType: "DoctorProfile", entityId: doctorId, metadata: { exceptionId: row.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }, ipAddress: ip }, tx);
    return row;
  });
  // Existing bookings are never auto-cancelled — front desk is told to reschedule them.
  const clashes = await prisma.appointment.count({ where: { doctorId, status: { in: OPEN_APPOINTMENT_STATUSES }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
  if (clashes > 0) {
    await notifyPermission(["appointments:cancel"], { category: "APPOINTMENT", title: "Appointments need rescheduling", body: `${clashes} booked appointment(s) fall inside a doctor's blocked time.`, link: `/doctors/${doctorId}` });
  }
  return { ...ex, conflictingAppointments: clashes };
}

export async function removeScheduleException(doctorId, exceptionId, session, ip) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.scheduleException.deleteMany({ where: { id: exceptionId, doctorId } });
    if (!r.count) throw notFound("Schedule exception not found.");
    await audit({ userId: session.user.id, action: "doctor.exception_delete", entityType: "DoctorProfile", entityId: doctorId, metadata: { exceptionId }, ipAddress: ip }, tx);
    return { id: exceptionId, removed: true };
  });
}

// ───────────────────────────── Staff ─────────────────────────────

export function staffSearchWhere(q) {
  const term = (q || "").trim();
  if (!term) return {};
  const parts = term.split(/\s+/);
  const or = [{ firstName: ci(term) }, { lastName: ci(term) }, { employeeNo: ci(term) }, { email: ci(term) }, { phone: { contains: term } }, { position: ci(term) }];
  if (parts.length > 1) or.push({ AND: [{ firstName: ci(parts[0]) }, { lastName: ci(parts.slice(1).join(" ")) }] });
  return { OR: or };
}

const STAFF_SORT = { name: ["lastName", "firstName"], employeeNo: ["employeeNo"], joiningDate: ["joiningDate"], position: ["position"] };

export async function listStaff({ q, page = 1, pageSize = 20, sort = "name", dir = "asc", status, departmentId, position }, { privileged }) {
  const where = { ...staffSearchWhere(q) };
  if (!privileged) where.employmentStatus = { in: ["ACTIVE", "ON_LEAVE"] };
  else if (EMPLOYMENT_STATUS.includes(status)) where.employmentStatus = status;
  if (departmentId) where.departmentId = departmentId;
  if (position) where.position = position;
  const fields = privileged ? (STAFF_SORT[sort] || STAFF_SORT.name) : sort === "employeeNo" ? STAFF_SORT.employeeNo : STAFF_SORT.name;
  const d = dir === "desc" ? "desc" : "asc";
  const [total, rows] = await Promise.all([
    prisma.staff.count({ where }),
    prisma.staff.findMany({
      where, orderBy: fields.map((f) => ({ [f]: d })), skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, employeeNo: true, firstName: true, lastName: true, email: true, phone: true, position: true,
        joiningDate: true, employmentStatus: true, shift: true, userId: true,
        department: { select: { id: true, name: true } },
        doctorProfile: { select: { id: true, specialty: true } },
        user: { select: { isActive: true } },
      },
    }),
  ]);
  return { rows: rows.map((r) => redactStaff(r, privileged)), meta: pageMeta(total, page, pageSize) };
}

/** Remove employment details / emergency contacts for viewers without hr:read or staff:manage. */
export function redactStaff(s, privileged) {
  if (privileged || !s) return s;
  const out = { ...s };
  for (const k of ["joiningDate", "employmentStatus", "shift", "emergencyContactName", "emergencyContactPhone", "userId", "user", "createdAt", "updatedAt"]) delete out[k];
  return out;
}

export async function listPositions() {
  const rows = await prisma.staff.findMany({ distinct: ["position"], select: { position: true }, orderBy: { position: "asc" } });
  return rows.map((r) => r.position);
}

export async function getStaff(id) {
  return prisma.staff.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true, code: true } },
      doctorProfile: { select: { id: true, specialty: true, licenseNumber: true, acceptsAppointments: true } },
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true, mustChangePassword: true, lockedUntil: true, roles: { select: { role: { select: { key: true, name: true } } } } } },
    },
  });
}

export async function createStaff(input, session, ip) {
  await assertDepartment(input.departmentId);
  return prisma.$transaction(async (tx) => {
    const s = await tx.staff.create({
      data: {
        ...staffDataFrom(input),
        employeeNo: await newId(tx, "employee"),
        employmentStatus: input.employmentStatus || "ACTIVE",
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
      },
    });
    await audit({ userId: session.user.id, action: "staff.create", entityType: "Staff", entityId: s.id, metadata: { employeeNo: s.employeeNo }, ipAddress: ip }, tx);
    return { id: s.id, employeeNo: s.employeeNo };
  });
}

export async function updateStaff(id, input, session, ip) {
  const existing = await prisma.staff.findUnique({ where: { id }, include: { doctorProfile: { select: { id: true } } } });
  if (!existing) throw notFound();
  if (input.departmentId !== existing.departmentId) await assertDepartment(input.departmentId);
  if (existing.doctorProfile && !input.departmentId) throw badRequest("Doctors must belong to a department.", { departmentId: "Doctors must belong to a department" });
  const data = { ...staffDataFrom(input), emergencyContactName: input.emergencyContactName ?? null, emergencyContactPhone: input.emergencyContactPhone ?? null };
  const changed = changedFields(existing, data);
  const nameChanged = data.firstName !== existing.firstName || data.lastName !== existing.lastName;
  return prisma.$transaction(async (tx) => {
    const s = await tx.staff.update({ where: { id }, data });
    // A doctor's clinical department follows their staff department.
    if (existing.doctorProfile && data.departmentId !== existing.departmentId) {
      await tx.doctorProfile.update({ where: { id: existing.doctorProfile.id }, data: { departmentId: data.departmentId } });
    }
    if (nameChanged && existing.userId) await tx.user.update({ where: { id: existing.userId }, data: { name: `${data.firstName} ${data.lastName}` } });
    await audit({ userId: session.user.id, action: "staff.update", entityType: "Staff", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return { id: s.id, employeeNo: s.employeeNo };
  });
}

/**
 * Employment status transition. SUSPENDED / TERMINATED deactivate the linked login and delete
 * every Session row (immediate revocation); returning to ACTIVE reactivates the login.
 */
export async function changeEmploymentStatus(id, { status: to, reason }, session, ip) {
  const s = await prisma.staff.findUnique({
    where: { id },
    include: { user: { select: { id: true, isActive: true, roles: { select: { role: { select: { key: true } } } } } }, doctorProfile: { select: { id: true } } },
  });
  if (!s) throw notFound();
  const from = s.employmentStatus;
  if (from === to) throw invalidState(`This staff member is already ${to.replace("_", " ").toLowerCase()}.`);
  if (!canTransitionEmployment(from, to)) throw invalidState(`Cannot change status from ${from} to ${to}.`);
  if (s.id === session.staff?.id || (s.userId && s.userId === session.user.id)) throw invalidState("You cannot change your own employment status.");
  if (s.user?.roles.some((r) => r.role.key === "SUPER_ADMIN") && !session.roles.includes("SUPER_ADMIN")) {
    throw forbidden("Only a super administrator can change the status of a super administrator.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.staff.updateMany({ where: { id, employmentStatus: from }, data: { employmentStatus: to } });
    if (!r.count) throw conflict("The status was changed by someone else. Refresh and try again.");
    let sessionsRevoked = 0;
    let account = null;
    if (s.userId) {
      if (REVOKING_STATUSES.includes(to)) {
        await tx.user.update({ where: { id: s.userId }, data: { isActive: false } });
        sessionsRevoked = (await tx.session.deleteMany({ where: { userId: s.userId } })).count;
        account = "deactivated";
      } else if (to === "ACTIVE" && REVOKING_STATUSES.includes(from)) {
        await tx.user.update({ where: { id: s.userId }, data: { isActive: true, failedLoginCount: 0, lockedUntil: null } });
        account = "reactivated";
      }
      if (account) {
        await audit({ userId: session.user.id, action: account === "deactivated" ? "user.deactivate" : "user.reactivate", entityType: "User", entityId: s.userId, metadata: { staffId: id, reason, sessionsRevoked }, ipAddress: ip }, tx);
      }
    }
    await audit({ userId: session.user.id, action: "staff.status_change", entityType: "Staff", entityId: id, metadata: { from, to, reason, account, sessionsRevoked }, ipAddress: ip }, tx);
    return { id, from, to, account, sessionsRevoked };
  });

  let futureAppointments = 0;
  if (s.doctorProfile && to !== "ACTIVE") {
    futureAppointments = await prisma.appointment.count({ where: { doctorId: s.doctorProfile.id, startsAt: { gte: new Date() }, status: { in: OPEN_APPOINTMENT_STATUSES } } });
    if (futureAppointments > 0) {
      await notifyPermission(["appointments:cancel"], { category: "APPOINTMENT", title: "Appointments need reassignment", body: `${futureAppointments} upcoming appointment(s) are booked with a doctor who is no longer available.`, link: `/doctors/${s.doctorProfile.id}` });
    }
  }
  return { ...result, futureAppointments };
}
