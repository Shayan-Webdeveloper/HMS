import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  windowsOverlap, findAvailabilityIssues, normalizeWindows, weeklyMinutes, availabilitySchema,
  canTransitionEmployment, canTransitionLeave, EMPLOYMENT_STATUS, REVOKING_STATUSES,
  leaveDayCount, dateRangesOverlap, summarizeAttendance, buildTempPassword,
  doctorSchema, exceptionSchema, leaveSchema, leaveActionSchema, attendanceSchema, departmentSchema, staffSchema, doctorListQuery, parseQuery, humanize,
} from "@/lib/validation/staff";
import { validatePasswordStrength } from "@/lib/auth/password";

const w = (weekday, startTime, endTime) => ({ weekday, startTime, endTime });

describe("availability windows", () => {
  it("detects overlap on the same weekday only", () => {
    expect(windowsOverlap(w(1, "09:00", "13:00"), w(1, "12:00", "15:00"))).toBe(true);
    expect(windowsOverlap(w(1, "09:00", "13:00"), w(2, "12:00", "15:00"))).toBe(false);
  });
  it("treats touching windows as non-overlapping", () => {
    expect(windowsOverlap(w(1, "09:00", "13:00"), w(1, "13:00", "17:00"))).toBe(false);
  });
  it("detects containment", () => {
    expect(windowsOverlap(w(3, "09:00", "17:00"), w(3, "10:00", "11:00"))).toBe(true);
  });
  it("accepts the seeded Mon–Sat split shifts", () => {
    const ws = [];
    for (let d = 1; d <= 6; d++) { ws.push(w(d, "09:00", "13:00")); if (d !== 6) ws.push(w(d, "14:00", "17:00")); }
    expect(findAvailabilityIssues(ws)).toEqual([]);
    expect(weeklyMinutes(ws)).toBe(6 * 240 + 5 * 180);
  });
  it("rejects end <= start", () => {
    expect(findAvailabilityIssues([w(1, "10:00", "10:00")])).toEqual([{ index: 0, field: "endTime", message: "End time must be after start time" }]);
    expect(findAvailabilityIssues([w(1, "14:00", "09:00")])[0].field).toBe("endTime");
  });
  it("flags the later of two overlapping windows with a readable message", () => {
    const issues = findAvailabilityIssues([w(2, "09:00", "12:00"), w(2, "11:30", "14:00")]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ index: 1, field: "startTime" });
    expect(issues[0].message).toContain("Tuesday");
  });
  it("does not report overlaps against an already-invalid window", () => {
    const issues = findAvailabilityIssues([w(1, "12:00", "09:00"), w(1, "10:00", "11:00")]);
    expect(issues.map((i) => i.index)).toEqual([0]);
  });
  it("validates format and weekday range", () => {
    expect(findAvailabilityIssues([w(7, "09:00", "10:00")])[0].field).toBe("weekday");
    expect(findAvailabilityIssues([w(1, "9:00", "10:00")])[0].field).toBe("startTime");
    expect(findAvailabilityIssues([w(1, "09:00", "24:00")])[0].field).toBe("endTime");
  });
  it("normalizes order and weekday type", () => {
    expect(normalizeWindows([w("3", "14:00", "15:00"), w(1, "10:00", "11:00"), w(3, "08:00", "09:00")])).toEqual([w(1, "10:00", "11:00"), w(3, "08:00", "09:00"), w(3, "14:00", "15:00")]);
  });
  it("schema surfaces overlap errors with field paths", () => {
    const r = availabilitySchema.safeParse({ windows: [w(1, "09:00", "13:00"), w(1, "12:00", "14:00")] });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(["windows", 1, "startTime"]);
    expect(availabilitySchema.safeParse({ windows: [] }).success).toBe(true);
  });
});

describe("state machines", () => {
  it("employment transitions", () => {
    expect(canTransitionEmployment("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionEmployment("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionEmployment("SUSPENDED", "ON_LEAVE")).toBe(false);
    expect(canTransitionEmployment("TERMINATED", "SUSPENDED")).toBe(false);
    for (const s of EMPLOYMENT_STATUS) expect(canTransitionEmployment(s, s)).toBe(false);
    expect(REVOKING_STATUSES).toEqual(["SUSPENDED", "TERMINATED"]);
  });
  it("leave transitions", () => {
    expect(canTransitionLeave("PENDING", "APPROVED")).toBe(true);
    expect(canTransitionLeave("APPROVED", "CANCELLED")).toBe(true);
    expect(canTransitionLeave("APPROVED", "REJECTED")).toBe(false);
    expect(canTransitionLeave("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionLeave("CANCELLED", "PENDING")).toBe(false);
  });
});

describe("date helpers", () => {
  it("counts leave days inclusively", () => {
    expect(leaveDayCount("2026-10-10", "2026-10-10")).toBe(1);
    expect(leaveDayCount("2026-10-10", "2026-10-14")).toBe(5);
    expect(leaveDayCount("2026-12-30", "2027-01-02")).toBe(4);
    expect(leaveDayCount("2026-10-14", "2026-10-10")).toBe(0);
    expect(leaveDayCount(new Date("2026-10-10T00:00:00Z"), new Date("2026-10-11T00:00:00Z"))).toBe(2);
  });
  it("detects inclusive date-range overlap", () => {
    expect(dateRangesOverlap("2026-10-01", "2026-10-05", "2026-10-05", "2026-10-09")).toBe(true);
    expect(dateRangesOverlap("2026-10-01", "2026-10-04", "2026-10-05", "2026-10-09")).toBe(false);
  });
});

describe("attendance summary", () => {
  it("counts statuses and unmarked rows", () => {
    const s = summarizeAttendance([{ status: "PRESENT" }, { status: "PRESENT" }, { status: "LATE" }, { status: null }, { status: "ON_LEAVE" }]);
    expect(s).toMatchObject({ PRESENT: 2, LATE: 1, ON_LEAVE: 1, ABSENT: 0, HALF_DAY: 0, UNMARKED: 1, total: 5 });
  });
  it("rejects duplicate staff in one save", () => {
    const r = attendanceSchema.safeParse({ date: "2026-10-09", entries: [{ staffId: "a", status: "PRESENT" }, { staffId: "a", status: "LATE" }] });
    expect(r.success).toBe(false);
  });
});

describe("temporary passwords", () => {
  it("always satisfies the password policy and varies", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const pw = buildTempPassword((n) => crypto.randomInt(n));
      expect(pw).toHaveLength(14);
      expect(validatePasswordStrength(pw)).toBeNull();
      expect(pw).not.toMatch(/[0O1lI]/);
      seen.add(pw);
    }
    expect(seen.size).toBe(200);
  });
  it("is deterministic for a fixed random source (all classes present even when rng returns 0)", () => {
    const pw = buildTempPassword(() => 0);
    expect(validatePasswordStrength(pw)).toBeNull();
  });
});

describe("schemas", () => {
  const doctor = { firstName: "A", lastName: "B", departmentId: "d1", position: "Consultant", joiningDate: "2026-01-01", specialty: "Cardiology", licenseNumber: "pmdc-1", consultationFee: "2500.00", slotMinutes: "20" };
  it("doctor: coerces slot, uppercases license, bounds slot length", () => {
    const r = doctorSchema.parse(doctor);
    expect(r.slotMinutes).toBe(20);
    expect(r.licenseNumber).toBe("PMDC-1");
    expect(r.acceptsAppointments).toBe(true);
    expect(doctorSchema.safeParse({ ...doctor, slotMinutes: 4 }).success).toBe(false);
    expect(doctorSchema.safeParse({ ...doctor, slotMinutes: 121 }).success).toBe(false);
    expect(doctorSchema.safeParse({ ...doctor, consultationFee: "12.345" }).success).toBe(false);
  });
  it("doctor: login account needs an email", () => {
    const r = doctorSchema.safeParse({ ...doctor, createAccount: true });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(["email"]);
    expect(doctorSchema.safeParse({ ...doctor, createAccount: true, email: "x@y.org" }).success).toBe(true);
  });
  it("staff: only ACTIVE / ON_LEAVE on create", () => {
    const base = { firstName: "A", lastName: "B", position: "Nurse", joiningDate: "2026-01-01" };
    expect(staffSchema.parse(base).employmentStatus).toBe("ACTIVE");
    expect(staffSchema.safeParse({ ...base, employmentStatus: "TERMINATED" }).success).toBe(false);
    expect(staffSchema.parse({ ...base, departmentId: "" }).departmentId).toBeUndefined();
  });
  it("exception: end must be after start", () => {
    expect(exceptionSchema.safeParse({ startDate: "2026-10-10", startTime: "09:00", endDate: "2026-10-10", endTime: "09:00", reason: "x" }).success).toBe(false);
    expect(exceptionSchema.safeParse({ startDate: "2026-10-10", startTime: "17:00", endDate: "2026-10-11", endTime: "09:00", reason: "Conference" }).success).toBe(true);
  });
  it("leave: dates ordered, reject requires a reason", () => {
    expect(leaveSchema.safeParse({ staffId: "s", type: "ANNUAL", startDate: "2026-10-10", endDate: "2026-10-09" }).success).toBe(false);
    expect(leaveActionSchema.safeParse({ action: "reject" }).success).toBe(false);
    expect(leaveActionSchema.safeParse({ action: "reject", reason: "Short staffed" }).success).toBe(true);
    expect(leaveActionSchema.safeParse({ action: "approve" }).success).toBe(true);
  });
  it("department code is normalised to upper case", () => {
    expect(departmentSchema.parse({ name: "Dermatology", code: " derm " }).code).toBe("DERM");
    expect(departmentSchema.safeParse({ name: "X", code: "a" }).success).toBe(false);
  });
  it("list query parsing falls back instead of throwing on junk", () => {
    const q = parseQuery(doctorListQuery, { page: "abc", accepting: "maybe" });
    expect(q.page).toBe(1);
    expect(q.accepting).toBeUndefined();
    expect(parseQuery(doctorListQuery, { accepting: "yes", departmentId: "d1" })).toMatchObject({ accepting: "yes", departmentId: "d1" });
  });
  it("humanize", () => {
    expect(humanize("HALF_DAY")).toBe("Half day");
  });
});
