import { describe, it, expect, beforeAll } from "vitest";
import { PERMISSIONS, ROLES } from "@/lib/permissions/matrix";
import { dayRangeUtc } from "@/lib/utils/time";
import { billingSettingsSchema, hospitalSettingsSchema, emergencySettingsSchema, appointmentPolicySchema } from "@/lib/validation/settings";
import { appointmentRequestSchema } from "@/lib/validation/portal";

// The service modules import the Prisma client (constructed lazily, never connected in these tests).
let dash, reports, users;
beforeAll(async () => {
  process.env.DATABASE_URL ||= "postgresql://unit:unit@localhost:5432/unit_tests";
  dash = await import("@/lib/services/dashboard");
  reports = await import("@/lib/services/reports");
  users = await import("@/lib/services/users");
});

const TZ = "Asia/Karachi"; // UTC+5, no DST

describe("dashboard period resolution", () => {
  const today = "2026-10-09";

  it("presets end today and include today", () => {
    expect(dash.resolvePeriod({ range: "today" }, today)).toMatchObject({ key: "today", from: today, to: today, days: 1 });
    expect(dash.resolvePeriod({ range: "7d" }, today)).toMatchObject({ from: "2026-10-03", to: today, days: 7 });
    expect(dash.resolvePeriod({ range: "30d" }, today)).toMatchObject({ from: "2026-09-10", to: today, days: 30 });
    expect(dash.resolvePeriod({ range: "90d" }, today)).toMatchObject({ from: "2026-07-12", to: today, days: 90 });
  });

  it("previous period is the equal-length run of days immediately before", () => {
    expect(dash.resolvePeriod({ range: "today" }, today).prev).toEqual({ from: "2026-10-08", to: "2026-10-08" });
    expect(dash.resolvePeriod({ range: "7d" }, today).prev).toEqual({ from: "2026-09-26", to: "2026-10-02" });
    const p = dash.resolvePeriod({ range: "custom", from: "2026-02-27", to: "2026-03-02" }, today); // crosses month end (non-leap year)
    expect(p).toMatchObject({ key: "custom", days: 4 });
    expect(p.prev).toEqual({ from: "2026-02-23", to: "2026-02-26" });
  });

  it("invalid or unknown input falls back to the default preset", () => {
    expect(dash.resolvePeriod({}, today).key).toBe(dash.DEFAULT_RANGE);
    expect(dash.resolvePeriod({ range: "bogus" }, today).key).toBe(dash.DEFAULT_RANGE);
    expect(dash.resolvePeriod({ range: "custom", from: "2026-10-09", to: "2026-10-01" }, today).key).toBe(dash.DEFAULT_RANGE); // reversed
    expect(dash.resolvePeriod({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, today).key).toBe(dash.DEFAULT_RANGE); // impossible date
    expect(dash.resolvePeriod({ range: "custom", from: "2024-01-01", to: "2026-01-01" }, today).key).toBe(dash.DEFAULT_RANGE); // > 366 days
  });

  it("UTC bounds follow hospital-local midnight", () => {
    const p = dash.resolvePeriod({ range: "7d" }, today);
    const b = dash.periodBounds(p, TZ);
    expect(b.start.toISOString()).toBe("2026-10-02T19:00:00.000Z"); // 03 Oct 00:00 PKT
    expect(b.end.toISOString()).toBe("2026-10-09T19:00:00.000Z"); // 10 Oct 00:00 PKT (exclusive)
    expect(b.prevStart.toISOString()).toBe("2026-09-25T19:00:00.000Z");
    expect(b.prevEnd.toISOString()).toBe(b.start.toISOString()); // contiguous, no overlap or gap
    expect(dayRangeUtc(today, TZ)[0].toISOString()).toBe("2026-10-08T19:00:00.000Z");
  });

  it("day helpers", () => {
    expect(dash.dayList("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(dash.daysBetween("2026-01-01", "2026-12-31")).toBe(364);
    const filled = dash.fillDaily(["2026-10-01", "2026-10-02"], new Map([["2026-10-02", { n: 3 }]]), ["n"]);
    expect(filled).toEqual([{ date: "2026-10-01", label: "01 Oct", n: 0 }, { date: "2026-10-02", label: "02 Oct", n: 3 }]);
  });
});

describe("trend helper", () => {
  it("computes percentage change against the previous period", () => {
    expect(dash.computeTrend(15, 10)).toEqual({ current: 15, previous: 10, pct: 50, direction: "up" });
    expect(dash.computeTrend(5, 10)).toMatchObject({ pct: -50, direction: "down" });
    expect(dash.computeTrend(7, 7)).toMatchObject({ pct: 0, direction: "flat" });
    expect(dash.computeTrend("1250.50", "1000.00")).toMatchObject({ pct: 25.1, direction: "up" }); // money strings
  });
  it("never invents a percentage when the previous value is zero", () => {
    expect(dash.computeTrend(4, 0)).toMatchObject({ pct: null, direction: "up" });
    expect(dash.computeTrend(0, 0)).toMatchObject({ pct: 0, direction: "flat" });
    expect(dash.computeTrend("x", 1)).toBeNull();
  });
});

describe("free-slot computation", () => {
  it("subtracts booked appointments, exceptions and past slots", () => {
    const date = "2026-10-12"; // Monday
    const at = (hhmm) => new Date(`${date}T${hhmm}:00+05:00`);
    const r = dash.computeFreeSlots({
      windows: [{ startTime: "09:00", endTime: "10:00" }], slotMinutes: 15, date, tz: TZ,
      booked: [{ startsAt: at("09:15"), endsAt: at("09:30") }],
      exceptions: [{ startsAt: at("09:45"), endsAt: at("11:00") }],
      now: at("08:00"),
    });
    expect(r).toEqual({ total: 4, free: 2 });
    const later = dash.computeFreeSlots({ windows: [{ startTime: "09:00", endTime: "10:00" }], slotMinutes: 15, date, tz: TZ, now: at("09:40") });
    expect(later).toEqual({ total: 4, free: 1 });
  });
});

describe("dashboard views", () => {
  const s = (perms, extra = {}) => ({ permissions: new Set(perms), roles: [], ...extra });
  it("compose sections from permissions, not role names", () => {
    expect(dash.availableViews(s(ROLES.HOSPITAL_ADMIN.permissions)).map((v) => v.key)).toContain("overview");
    expect(dash.availableViews(s(ROLES.LAB_TECHNICIAN.permissions)).map((v) => v.key)).toEqual(["laboratory"]);
    const doc = dash.availableViews(s(ROLES.DOCTOR.permissions, { doctorId: "d1" })).map((v) => v.key);
    expect(doc).toContain("doctor");
    expect(doc).not.toContain("reception"); // doctors can book, but get their own clinic view instead
  });
  it("admins land on the overview, others on their own work first", () => {
    const admin = s(ROLES.HOSPITAL_ADMIN.permissions);
    expect(dash.defaultView(admin, dash.availableViews(admin))).toBe("overview");
    const doctor = s(ROLES.DOCTOR.permissions, { doctorId: "d1" });
    expect(dash.defaultView(doctor, dash.availableViews(doctor))).toBe("doctor");
    expect(dash.defaultView(s([]), [])).toBeNull();
  });
});

describe("portal cancellation rule", () => {
  const now = new Date("2026-10-09T06:00:00Z");
  const appt = (status, hoursAhead) => ({ status, startsAt: new Date(now.getTime() + hoursAhead * 3600000) });
  it("requires the configured notice for confirmed visits", () => {
    expect(dash.portalCancelBlocker(appt("CONFIRMED", 10), 4, now)).toBeNull();
    expect(dash.portalCancelBlocker(appt("SCHEDULED", 3), 4, now)).toMatch(/4 hours/);
  });
  it("allows withdrawing a request until it starts, and blocks other states", () => {
    expect(dash.portalCancelBlocker(appt("REQUESTED", 1), 4, now)).toBeNull();
    expect(dash.portalCancelBlocker(appt("REQUESTED", -1), 4, now)).toMatch(/passed/);
    expect(dash.portalCancelBlocker(appt("CHECKED_IN", 10), 4, now)).toMatch(/no longer/);
    expect(dash.portalCancelBlocker(appt("COMPLETED", 10), 4, now)).toMatch(/no longer/);
  });
});

describe("report configuration integrity", () => {
  const FORMATS = ["text", "int", "decimal", "money", "percent", "hours", "date", "dateOnly", "datetime", "status"];
  it("every report is complete and uniquely keyed", () => {
    const keys = reports.REPORTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of reports.REPORTS) {
      expect(r.key, r.key).toMatch(/^[a-z0-9-]+$/);
      expect(r.title && r.description && r.definition, r.key).toBeTruthy();
      expect(reports.REPORT_CATEGORIES, r.key).toContain(r.category);
      expect(typeof r.run, r.key).toBe("function");
      expect(r.requires, r.key).toContain("reports:read");
      for (const p of r.requires) expect(PERMISSIONS[p], `${r.key}: ${p}`).toBeDefined();
      expect(r.columns.length, r.key).toBeGreaterThan(0);
      const colKeys = r.columns.map((c) => c.key);
      expect(new Set(colKeys).size, r.key).toBe(colKeys.length);
      for (const c of r.columns) {
        expect(c.key && c.label, `${r.key} column`).toBeTruthy();
        expect(FORMATS, `${r.key}.${c.key}`).toContain(c.format ?? "text");
      }
      for (const f of r.filters) expect(["dateRange", "department", "doctor", "status"], r.key).toContain(f);
      if (r.filters.includes("status")) expect(r.statusOptions?.length, r.key).toBeGreaterThan(0);
      if (r.defaultStatus) expect(r.statusOptions.map((o) => o.value), r.key).toContain(r.defaultStatus);
    }
  });
  it("money-based reports require the financial permission", () => {
    for (const r of reports.REPORTS) {
      const hasMoney = r.columns.some((c) => c.format === "money");
      if (hasMoney || r.category === "Finance") expect(r.requires, r.key).toContain("reports:financial");
    }
  });
  it("covers the required report catalogue", () => {
    const keys = reports.REPORTS.map((r) => r.key);
    for (const k of ["patient-registrations", "appointments", "doctor-workload", "department-activity", "opd", "admissions-discharges", "bed-occupancy", "emergency", "laboratory-tests", "pharmacy-sales", "medicine-stock", "expiry", "inventory-valuation", "revenue", "payment-collections", "outstanding-invoices", "refunds", "insurance-claims", "staff-attendance"]) expect(keys).toContain(k);
  });
  it("report access follows permissions", () => {
    const sess = (role) => ({ permissions: new Set(ROLES[role].permissions) });
    const acc = (role) => reports.reportsFor(sess(role)).map((r) => r.key);
    expect(acc("ACCOUNTANT")).toContain("revenue");
    expect(acc("DOCTOR")).not.toContain("revenue");
    expect(acc("DOCTOR")).not.toContain("staff-attendance");
    expect(acc("HR_MANAGER")).toContain("staff-attendance");
    expect(acc("LAB_TECHNICIAN")).toEqual([]);
    expect(reports.canExportReport(sess("DOCTOR"), reports.getReport("appointments"))).toBe(false);
    expect(reports.canExportReport(sess("HOSPITAL_ADMIN"), reports.getReport("revenue"))).toBe(true);
  });
  it("normalises report filters", () => {
    const rep = reports.getReport("appointments");
    const f = reports.resolveReportFilters(rep, { from: "2026-10-05", to: "2026-10-01", status: "NOPE", doctorId: "x'; drop" }, TZ);
    expect([f.from, f.to]).toEqual(["2026-10-01", "2026-10-05"]); // swapped
    expect(f.status).toBe("");
    expect(f.doctorId).toBe("");
    expect(f.start.toISOString()).toBe("2026-09-30T19:00:00.000Z");
    const exp = reports.resolveReportFilters(reports.getReport("expiry"), {}, TZ);
    expect(exp.status).toBe("ALERT"); // default status
  });
  it("formats cells for screen and CSV", () => {
    const ctx = { tz: TZ, currency: "PKR", locale: "en-PK" };
    expect(reports.csvValue("1234.5", "money", ctx)).toBe("1234.50");
    expect(reports.csvValue(new Date("2026-10-08T20:30:00Z"), "datetime", ctx)).toBe("2026-10-09 01:30");
    expect(reports.formatCell(null, "int", ctx)).toBe("—");
    expect(reports.formatCell(12.345, "percent", ctx)).toBe("12.3%");
    expect(reports.formatCell("PARTIALLY_PAID", "status", ctx)).toBe("Partially paid");
  });
});

describe("role editing guard rules", () => {
  const superA = { id: "u-super", roles: ["SUPER_ADMIN"] };
  const hadmin = { id: "u-admin", roles: ["HOSPITAL_ADMIN"] };
  const known = Object.keys(ROLES);
  const check = (actor, target, nextRoles, activeSuperAdmins = 2) => users.checkRoleChange({ actor, target, nextRoles, activeSuperAdmins, knownRoles: known });

  it("only a Super Administrator can grant, revoke or edit Super Administrator", () => {
    expect(check(hadmin, { id: "x", roles: ["NURSE"], isActive: true }, ["NURSE", "SUPER_ADMIN"])).toMatch(/Only a Super/);
    expect(check(hadmin, { id: "s2", roles: ["SUPER_ADMIN"], isActive: true }, ["SUPER_ADMIN", "DOCTOR"])).toMatch(/Only a Super/);
    expect(check(hadmin, null, ["SUPER_ADMIN"])).toMatch(/Only a Super/);
    expect(check(superA, { id: "x", roles: ["NURSE"], isActive: true }, ["SUPER_ADMIN"])).toBeNull();
  });
  it("prevents removing your own Super Administrator role and self-escalation", () => {
    expect(check(superA, { id: "u-super", roles: ["SUPER_ADMIN"], isActive: true }, ["HOSPITAL_ADMIN"])).toMatch(/your own Super/);
    expect(check(superA, { id: "u-super", roles: ["SUPER_ADMIN"], isActive: true }, ["SUPER_ADMIN", "DOCTOR"])).toBeNull();
    expect(check(hadmin, { id: "u-admin", roles: ["HOSPITAL_ADMIN"], isActive: true }, ["HOSPITAL_ADMIN", "DOCTOR"])).toMatch(/your own roles/);
  });
  it("protects the last active Super Administrator", () => {
    const other = { id: "s2", roles: ["SUPER_ADMIN"], isActive: true };
    expect(check(superA, other, ["HOSPITAL_ADMIN"], 1)).toMatch(/last active/);
    expect(check(superA, other, ["HOSPITAL_ADMIN"], 2)).toBeNull();
    expect(check(superA, { ...other, isActive: false }, ["HOSPITAL_ADMIN"], 1)).toBeNull(); // an inactive one does not count
  });
  it("keeps the Patient role exclusive and rejects unknown roles", () => {
    expect(check(superA, null, ["PATIENT", "NURSE"])).toMatch(/cannot be combined/);
    expect(check(hadmin, null, ["PATIENT"])).toBeNull();
    expect(check(hadmin, null, ["WIZARD"])).toMatch(/Unknown role/);
    expect(check(hadmin, null, [])).toMatch(/at least one/);
  });
  it("status changes: no self-deactivation and the last Super Administrator stays active", () => {
    const s2 = { id: "s2", roles: ["SUPER_ADMIN"], isActive: true };
    expect(users.checkStatusChange({ actor: superA, target: { id: "u-super", roles: ["SUPER_ADMIN"], isActive: true }, active: false, activeSuperAdmins: 3 })).toMatch(/your own/);
    expect(users.checkStatusChange({ actor: superA, target: s2, active: false, activeSuperAdmins: 1 })).toMatch(/last active/);
    expect(users.checkStatusChange({ actor: hadmin, target: s2, active: false, activeSuperAdmins: 3 })).toMatch(/Only a Super/);
    expect(users.checkStatusChange({ actor: hadmin, target: { id: "n", roles: ["NURSE"], isActive: true }, active: false, activeSuperAdmins: 1 })).toBeNull();
  });
});

describe("permission matrix guard rules", () => {
  const all = Object.keys(PERMISSIONS);
  it("Super Administrator must keep users:manage and settings:manage", () => {
    const withoutUsers = ROLES.SUPER_ADMIN.permissions.filter((p) => p !== "users:manage");
    expect(users.validateRolePermissions("SUPER_ADMIN", withoutUsers, all)).toMatch(/users:manage/);
    expect(users.validateRolePermissions("SUPER_ADMIN", ["users:manage", "settings:manage"], all)).toBeNull();
  });
  it("Patient role may only hold portal:access, which is reserved for it", () => {
    expect(users.validateRolePermissions("PATIENT", ["portal:access"], all)).toBeNull();
    expect(users.validateRolePermissions("PATIENT", [], all)).toBeNull();
    expect(users.validateRolePermissions("PATIENT", ["portal:access", "patients:read"], all)).toMatch(/only hold/);
    expect(users.validateRolePermissions("NURSE", ["vitals:create", "portal:access"], all)).toMatch(/reserved/);
  });
  it("rejects unknown permission keys and accepts the shipped defaults", () => {
    expect(users.validateRolePermissions("NURSE", ["vitals:create", "teleport:anywhere"], all)).toMatch(/Unknown permission/);
    for (const [key, r] of Object.entries(ROLES)) expect(users.validateRolePermissions(key, r.permissions, all), key).toBeNull();
  });
  it("diffs permission sets for the audit trail", () => {
    expect(users.diffKeys(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });
  it("temporary passwords satisfy the password policy", () => {
    for (let i = 0; i < 50; i++) {
      const pw = users.generateTempPassword();
      expect(pw).toMatch(/^[A-Za-z0-9]{14}$/);
      expect(pw).toMatch(/[A-Za-z]/);
      expect(pw).toMatch(/[0-9]/);
    }
  });
});

describe("settings & portal validation", () => {
  it("validates hospital time zone, currency and locale", () => {
    const base = { name: "H", timezone: "Asia/Karachi", currency: "pkr", locale: "en-PK" };
    expect(hospitalSettingsSchema.parse(base).currency).toBe("PKR");
    expect(hospitalSettingsSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(hospitalSettingsSchema.safeParse({ ...base, currency: "RUPEES" }).success).toBe(false);
    expect(hospitalSettingsSchema.safeParse({ ...base, locale: "not a locale!" }).success).toBe(false);
  });
  it("validates billing and appointment policy", () => {
    expect(billingSettingsSchema.safeParse({ taxRatePercent: "17.5", paymentMethods: ["CASH", "ONLINE"], maxDiscountPercentWithoutApproval: 10 }).success).toBe(true);
    expect(billingSettingsSchema.safeParse({ taxRatePercent: "100.01", paymentMethods: ["CASH"], maxDiscountPercentWithoutApproval: 10 }).success).toBe(false);
    expect(billingSettingsSchema.safeParse({ taxRatePercent: "5", paymentMethods: ["CHEQUE"], maxDiscountPercentWithoutApproval: 10 }).success).toBe(false);
    expect(billingSettingsSchema.safeParse({ taxRatePercent: "5", paymentMethods: [], maxDiscountPercentWithoutApproval: 10 }).success).toBe(false);
    expect(appointmentPolicySchema.safeParse({ workdayStart: "17:00", workdayEnd: "09:00", defaultSlotMinutes: 15, allowPatientRequests: true, minCancelHours: 4 }).success).toBe(false);
  });
  it("triage categories need unique keys and hex colours", () => {
    const ok = emergencySettingsSchema.safeParse({ triageCategories: [{ key: "red", label: "Immediate", color: "#dc2626" }] });
    expect(ok.success && ok.data.triageCategories[0].key).toBe("RED");
    expect(emergencySettingsSchema.safeParse({ triageCategories: [{ key: "RED", label: "A", color: "#dc2626" }, { key: "RED", label: "B", color: "#ea580c" }] }).success).toBe(false);
    expect(emergencySettingsSchema.safeParse({ triageCategories: [{ key: "RED", label: "A", color: "red" }] }).success).toBe(false);
  });
  it("portal appointment requests never carry a patient id", () => {
    const r = appointmentRequestSchema.parse({ doctorId: "doc1", preferredDate: "2026-10-12", reason: "Review", patientId: "someone-else" });
    expect(r).not.toHaveProperty("patientId");
  });
});
