import { z } from "zod";
import { requiredText, optionalText, dateString, timeString, phone, email, money, listQuery } from "./common.js";

// ───────────────────────────── Enumerations ─────────────────────────────

export const EMPLOYMENT_STATUS = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"];
export const ATTENDANCE_STATUS = ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "ON_LEAVE"];
export const LEAVE_STATUS = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
export const LEAVE_TYPES = ["ANNUAL", "SICK", "CASUAL", "MATERNITY", "PATERNITY", "COMPASSIONATE", "UNPAID", "OTHER"];
export const SHIFTS = ["MORNING", "EVENING", "NIGHT", "ROTATING"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "HALF_DAY" → "Half day" */
export const humanize = (s) => (s ? String(s).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "");
export const enumOptions = (values) => values.map((v) => ({ value: v, label: humanize(v) }));

// ───────────────────────────── State machines ─────────────────────────────

/** Allowed employment-status transitions. Reactivation is always via ACTIVE. */
export const EMPLOYMENT_TRANSITIONS = {
  ACTIVE: ["ON_LEAVE", "SUSPENDED", "TERMINATED"],
  ON_LEAVE: ["ACTIVE", "SUSPENDED", "TERMINATED"],
  SUSPENDED: ["ACTIVE", "TERMINATED"],
  TERMINATED: ["ACTIVE"],
};
/** Statuses that immediately revoke the linked login account. */
export const REVOKING_STATUSES = ["SUSPENDED", "TERMINATED"];

export function canTransitionEmployment(from, to) {
  return (EMPLOYMENT_TRANSITIONS[from] || []).includes(to);
}

export const LEAVE_TRANSITIONS = {
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["CANCELLED"],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransitionLeave(from, to) {
  return (LEAVE_TRANSITIONS[from] || []).includes(to);
}

// ───────────────────────────── Pure helpers ─────────────────────────────

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

/** Two weekly windows overlap when they share a weekday and their [start, end) ranges intersect. Touching edges do not overlap. */
export function windowsOverlap(a, b) {
  return Number(a.weekday) === Number(b.weekday) && toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
}

/**
 * Validates a list of weekly availability windows.
 * Returns [{ index, field, message }] — empty when valid.
 */
export function findAvailabilityIssues(windows) {
  const issues = [];
  const list = Array.isArray(windows) ? windows : [];
  list.forEach((w, i) => {
    const wd = Number(w?.weekday);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) { issues.push({ index: i, field: "weekday", message: "Choose a weekday" }); return; }
    if (!HHMM.test(w.startTime || "")) { issues.push({ index: i, field: "startTime", message: "Use HH:MM" }); return; }
    if (!HHMM.test(w.endTime || "")) { issues.push({ index: i, field: "endTime", message: "Use HH:MM" }); return; }
    if (toMinutes(w.endTime) <= toMinutes(w.startTime)) { issues.push({ index: i, field: "endTime", message: "End time must be after start time" }); return; }
    for (let j = 0; j < i; j++) {
      const o = list[j];
      if (!o || !HHMM.test(o.startTime || "") || !HHMM.test(o.endTime || "") || toMinutes(o.endTime) <= toMinutes(o.startTime)) continue;
      if (windowsOverlap(w, o)) {
        issues.push({ index: i, field: "startTime", message: `Overlaps ${o.startTime}–${o.endTime} on ${WEEKDAYS[wd]}` });
        break;
      }
    }
  });
  return issues;
}

/** Sort windows by weekday then start time and coerce weekday to a number. */
export function normalizeWindows(windows) {
  return [...windows]
    .map((w) => ({ weekday: Number(w.weekday), startTime: w.startTime, endTime: w.endTime }))
    .sort((a, b) => a.weekday - b.weekday || toMinutes(a.startTime) - toMinutes(b.startTime));
}

/** Total scheduled minutes per week. */
export function weeklyMinutes(windows) {
  return windows.reduce((s, w) => s + Math.max(0, toMinutes(w.endTime) - toMinutes(w.startTime)), 0);
}

/** Inclusive number of calendar days between two "YYYY-MM-DD" strings (or @db.Date values). */
export function leaveDayCount(start, end) {
  const a = Date.parse(typeof start === "string" ? `${start.slice(0, 10)}T00:00:00Z` : start);
  const b = Date.parse(typeof end === "string" ? `${end.slice(0, 10)}T00:00:00Z` : end);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Inclusive date-range overlap ("YYYY-MM-DD" strings compare lexicographically). */
export function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Count attendance statuses. rows: [{ status: string|null }] → { PRESENT, ABSENT, …, UNMARKED, total } */
export function summarizeAttendance(rows) {
  const out = Object.fromEntries(ATTENDANCE_STATUS.map((s) => [s, 0]));
  out.UNMARKED = 0;
  for (const r of rows) {
    if (r.status && out[r.status] !== undefined) out[r.status]++;
    else out.UNMARKED++;
  }
  out.total = rows.length;
  return out;
}

const PW_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const PW_DIGITS = "23456789";
const PW_SYMBOLS = "!@#$%*?";

/**
 * Builds a temporary password from an injected uniform random-int source (crypto.randomInt on the server).
 * Guarantees letters, digits and a symbol; avoids look-alike characters (0/O, 1/l/I).
 */
export function buildTempPassword(randomInt, length = 14) {
  const all = PW_LETTERS + PW_DIGITS + PW_SYMBOLS;
  const chars = [
    PW_LETTERS[randomInt(PW_LETTERS.length)],
    PW_LETTERS[randomInt(PW_LETTERS.length)],
    PW_DIGITS[randomInt(PW_DIGITS.length)],
    PW_DIGITS[randomInt(PW_DIGITS.length)],
    PW_SYMBOLS[randomInt(PW_SYMBOLS.length)],
  ];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Fisher–Yates shuffle so the guaranteed classes are not in fixed positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export const doctorName = (staff) => (staff ? `${staff.firstName} ${staff.lastName}` : "");

// ───────────────────────────── Schemas ─────────────────────────────

const optionalEnum = (values) => z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(values).optional());
const requiredId = (label) => z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(64);
const optionalId = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().trim().max(64).optional());

const personFields = {
  firstName: requiredText(80, "First name"),
  lastName: requiredText(80, "Last name"),
  email,
  phone,
};

export const doctorSchema = z.object({
  ...personFields,
  departmentId: requiredId("Department"),
  position: requiredText(120, "Position"),
  joiningDate: dateString,
  shift: optionalEnum(SHIFTS),
  specialty: requiredText(120, "Specialty"),
  qualifications: optionalText(300),
  licenseNumber: z.string({ error: "License number is required" }).trim().min(3, "License number is required").max(60).regex(/^[A-Za-z0-9][A-Za-z0-9/._-]*$/, "Letters, digits, / . _ - only").transform((v) => v.toUpperCase()),
  consultationFee: money,
  slotMinutes: z.coerce.number({ error: "Enter the slot length in minutes" }).int("Whole minutes only").min(5, "Minimum 5 minutes").max(120, "Maximum 120 minutes"),
  acceptsAppointments: z.boolean().optional().default(true),
  createAccount: z.boolean().optional().default(false),
}).refine((v) => !v.createAccount || !!v.email, { path: ["email"], message: "An email is required to create a login account" });

export const staffSchema = z.object({
  ...personFields,
  departmentId: optionalId,
  position: requiredText(120, "Position"),
  joiningDate: dateString,
  shift: optionalEnum(SHIFTS),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: phone,
  employmentStatus: z.enum(["ACTIVE", "ON_LEAVE"]).optional().default("ACTIVE"),
});

export const statusChangeSchema = z.object({
  status: z.enum(EMPLOYMENT_STATUS, { error: "Choose a status" }),
  reason: z.string({ error: "Give a reason" }).trim().min(3, "Give a reason (min 3 characters)").max(300),
});

export const availabilityWindowSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: timeString,
  endTime: timeString,
});

export const availabilitySchema = z.object({ windows: z.array(availabilityWindowSchema).max(84, "Too many windows") }).superRefine((v, ctx) => {
  for (const issue of findAvailabilityIssues(v.windows)) ctx.addIssue({ code: "custom", path: ["windows", issue.index, issue.field], message: issue.message });
});

export const exceptionSchema = z.object({
  startDate: dateString,
  startTime: timeString,
  endDate: dateString,
  endTime: timeString,
  reason: requiredText(200, "Reason"),
}).refine((v) => `${v.endDate}T${v.endTime}` > `${v.startDate}T${v.startTime}`, { path: ["endTime"], message: "End must be after start" })
  .refine((v) => leaveDayCount(v.startDate, v.endDate) <= 366, { path: ["endDate"], message: "An exception can span at most one year" });

export const attendanceSchema = z.object({
  date: dateString,
  entries: z.array(z.object({ staffId: requiredId("Staff"), status: z.enum(ATTENDANCE_STATUS), note: optionalText(200) })).min(1, "Mark at least one staff member").max(2000),
}).refine((v) => new Set(v.entries.map((e) => e.staffId)).size === v.entries.length, { path: ["entries"], message: "Each staff member can appear only once" });

export const leaveSchema = z.object({
  staffId: requiredId("Staff member"),
  type: z.enum(LEAVE_TYPES, { error: "Choose a leave type" }),
  startDate: dateString,
  endDate: dateString,
  reason: optionalText(500),
}).refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "End date cannot be before the start date" })
  .refine((v) => leaveDayCount(v.startDate, v.endDate) <= 365, { path: ["endDate"], message: "Leave can span at most 365 days" });

export const leaveActionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  reason: optionalText(300),
}).refine((v) => v.action !== "reject" || (v.reason && v.reason.length >= 3), { path: ["reason"], message: "A reason is required to reject a request" });

export const departmentSchema = z.object({
  name: requiredText(120, "Name"),
  code: z.string({ error: "Code is required" }).trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,11}$/, "2–12 letters, digits, - or _"),
  description: optionalText(500),
  isClinical: z.boolean().optional().default(true),
});

export const departmentStatusSchema = z.object({ isActive: z.boolean(), reason: optionalText(300) });

// ───────────────────────────── List queries ─────────────────────────────

const optionalFilter = (max = 64) => z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().trim().max(max).optional()).catch(undefined);

export const doctorListQuery = listQuery.extend({
  departmentId: optionalFilter(),
  accepting: z.enum(["yes", "no"]).optional().catch(undefined),
  scope: z.enum(["bookable", "all"]).optional().catch(undefined),
});

export const staffListQuery = listQuery.extend({
  departmentId: optionalFilter(),
  position: optionalFilter(120),
});

export const leaveListQuery = listQuery.extend({ staffId: optionalFilter() });

export const attendanceQuery = z.object({
  date: z.preprocess((v) => (v === "" || v == null ? undefined : v), dateString.optional()).catch(undefined),
  departmentId: optionalFilter(),
  q: z.string().trim().max(100).optional().catch(undefined),
});

/** Parse URL params with a schema, falling back to defaults instead of throwing on junk input. */
export function parseQuery(schema, params) {
  const r = schema.safeParse(params || {});
  return r.success ? r.data : schema.parse({});
}
