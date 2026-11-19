// Create one sign-in account for every role (plus a Platform Administrator and a test patient) in
// ONE hospital, e.g. to hand out initial production logins.
//
//   ACCOUNT_DOMAIN=myhospital.com HOSPITAL_CODE=DGH npm run create-role-accounts
//
// * Every account gets a random temporary password and must change it at first sign-in.
// * Passwords are written ONLY to .tmp/role-accounts.txt (gitignored, owner-readable), never printed.
// * Safe to re-run: existing accounts are left untouched (no password reset) and reported as "exists".
// * Staff accounts get a Staff record in a matching department; the doctor also gets a DoctorProfile
//   with Mon–Sat clinic hours; the patient account is linked (verified) to a new patient record.
import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../lib/db/client-factory.js";
import { createTenantClient, runWithTenant } from "../lib/db/tenant-client.js";
import { ensurePermissionCatalogue } from "../lib/tenancy/provision.js";
import { newId } from "../lib/ids.js";

const domain = (process.env.ACCOUNT_DOMAIN || "").trim().toLowerCase();
const code = (process.env.HOSPITAL_CODE || "").trim().toUpperCase();
const OUT = ".tmp/role-accounts.txt";

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) fail("Set ACCOUNT_DOMAIN to a domain such as myhospital.com.");
if (domain === "demo.hms") fail("Demo addresses (@demo.hms) cannot be used for real accounts.");

// [local part, role, first name, last name, department code, position]
const STAFF = [
  ["superadmin", "SUPER_ADMIN", "Super", "Administrator", "ADM", "Super Administrator"],
  ["admin", "HOSPITAL_ADMIN", "Hospital", "Administrator", "ADM", "Hospital Administrator"],
  ["reception", "RECEPTIONIST", "Front", "Desk", "ADM", "Receptionist"],
  ["doctor", "DOCTOR", "Duty", "Doctor", "GM", "Consultant Physician"],
  ["nurse", "NURSE", "Duty", "Nurse", "NUR", "Staff Nurse"],
  ["lab", "LAB_TECHNICIAN", "Lab", "Technician", "LAB", "Laboratory Technician"],
  ["radiology", "RADIOLOGIST", "Radiology", "Staff", "RAD", "Radiologist"],
  ["pharmacy", "PHARMACIST", "Duty", "Pharmacist", "PHR", "Pharmacist"],
  ["billing", "ACCOUNTANT", "Billing", "Officer", "FIN", "Accountant / Billing Officer"],
  ["hr", "HR_MANAGER", "HR", "Manager", "ADM", "HR Manager"],
];
const DEPT_NAMES = { ADM: "Administration", GM: "General Medicine", NUR: "Nursing", LAB: "Laboratory", RAD: "Radiology", PHR: "Pharmacy", FIN: "Finance" };
const CLINICAL = new Set(["GM", "NUR", "LAB", "RAD"]);

/** 20 random URL-safe characters, guaranteed to contain a letter and a digit. */
function tempPassword() {
  for (;;) {
    const pw = crypto.randomBytes(15).toString("base64url");
    if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

const base = createPrismaClient();
const prisma = createTenantClient(base);
const results = []; // { email, role, status, password? } — only accounts that really exist

/** Write the passwords of committed accounts to the gitignored file (also on failure, so none is lost). */
function saveReport(hospital) {
  const created = results.filter((r) => r.status === "created" && !r.saved);
  if (!created.length) return;
  fs.mkdirSync(".tmp", { recursive: true });
  const lines = [
    `HMS accounts for ${hospital ? `${hospital.name} (${hospital.code})` : "(no hospital)"} — created ${new Date().toISOString()}`,
    "Temporary passwords: each person must change theirs at first sign-in. Delete this file once handed out.",
    "",
    ...created.map((r) => `${r.role.padEnd(16)} ${r.email.padEnd(32)} ${r.password}`),
    "",
  ];
  fs.appendFileSync(OUT, lines.join("\n"), { mode: 0o600 });
  for (const r of created) r.saved = true;
}

let hospital = null;
try {
  await ensurePermissionCatalogue(base);
  const roleRows = Object.fromEntries((await base.role.findMany()).map((r) => [r.key, r]));

  if (code) {
    hospital = await base.hospital.findUnique({ where: { code } });
    if (!hospital) fail(`No hospital with code ${code}.`);
  } else {
    const all = await base.hospital.findMany({ take: 2 });
    if (all.length !== 1) fail("Set HOSPITAL_CODE to choose the hospital.");
    hospital = all[0];
  }

  // ── Platform Administrator (above hospitals, no hospital membership) ──
  {
    const email = `platform@${domain}`;
    const existing = await base.user.findUnique({ where: { email } });
    if (existing) results.push({ email, role: "PLATFORM_ADMIN", status: "exists" });
    else {
      const password = tempPassword();
      const user = await base.user.create({ data: { email, name: "Platform Administrator", passwordHash: await bcrypt.hash(password, 12), platformRole: "PLATFORM_ADMIN", mustChangePassword: true } });
      await base.auditLog.create({ data: { hospitalId: null, userId: user.id, action: "system.create_platform_admin", entityType: "User", entityId: user.id } });
      results.push({ email, role: "PLATFORM_ADMIN", status: "created", password });
    }
  }

  // ── Hospital accounts: one transaction carrying the hospital context (role hms_app + RLS) ──
  const pending = [];
  for (const [local, role, first, last, deptCode, position] of [...STAFF, ["patient", "PATIENT", "Test", "Patient"]]) {
    const email = `${local}@${domain}`;
    if (await base.user.findUnique({ where: { email }, select: { id: true } })) results.push({ email, role, status: "exists" });
    else pending.push({ email, role, first, last, deptCode, position, password: tempPassword() });
  }
  for (const p of pending) p.passwordHash = await bcrypt.hash(p.password, 12);

  if (pending.length) {
    const committed = []; // reported only after the transaction commits
    await runWithTenant({ hospitalId: hospital.id }, () => prisma.$transaction(async (tx) => {
      const deptCache = {};
      async function dept(deptCode) {
        if (deptCache[deptCode]) return deptCache[deptCode];
        const found = await tx.department.findFirst({ where: { code: deptCode } });
        deptCache[deptCode] = found ?? await tx.department.create({ data: { code: deptCode, name: DEPT_NAMES[deptCode], isClinical: CLINICAL.has(deptCode) } });
        return deptCache[deptCode];
      }

      for (const p of pending) {
        const user = await tx.user.create({
          data: { email: p.email, name: `${p.first} ${p.last}`, passwordHash: p.passwordHash, mustChangePassword: true, memberships: { create: {} }, roles: { create: [{ roleId: roleRows[p.role].id }] } },
        });
        if (p.role === "PATIENT") {
          const patient = await tx.patient.create({ data: { mrn: await newId(tx, "patient"), firstName: p.first, lastName: p.last, email: p.email, createdById: user.id } });
          await tx.patientUserLink.create({ data: { patientId: patient.id, userId: user.id, verifiedAt: new Date() } });
        } else {
          const d = await dept(p.deptCode);
          const staff = await tx.staff.create({
            data: { employeeNo: await newId(tx, "employee"), userId: user.id, firstName: p.first, lastName: p.last, email: p.email, departmentId: d.id, position: p.position, joiningDate: new Date(new Date().toISOString().slice(0, 10)) },
          });
          if (p.role === "DOCTOR") {
            // Placeholder licence number (unique per hospital): replace it with the real one in Doctors → Edit.
            const doc = await tx.doctorProfile.create({ data: { staffId: staff.id, departmentId: d.id, specialty: "General Medicine", licenseNumber: `PENDING-${staff.employeeNo}`, consultationFee: "2000.00", slotMinutes: 15 } });
            const avail = [];
            for (let wd = 1; wd <= 6; wd++) {
              avail.push({ doctorId: doc.id, weekday: wd, startTime: "09:00", endTime: "13:00" });
              if (wd !== 6) avail.push({ doctorId: doc.id, weekday: wd, startTime: "14:00", endTime: "17:00" });
            }
            await tx.doctorAvailability.createMany({ data: avail });
          }
        }
        await tx.auditLog.create({ data: { userId: user.id, action: "system.create_role_account", entityType: "User", entityId: user.id, metadata: { role: p.role } } });
        committed.push({ email: p.email, role: p.role, status: "created", password: p.password });
      }
    }, { timeout: 120000, maxWait: 30000 }));
    results.push(...committed);
  }

  console.log(`Hospital: ${hospital.name} (${hospital.code})`);
  for (const r of results) console.log(`  ${r.status === "created" ? "✔ created" : "• exists "}  ${r.role.padEnd(16)} ${r.email}`);
} finally {
  // Passwords go only to the gitignored file — also when something failed after some accounts were created.
  saveReport(hospital);
  if (results.some((r) => r.saved)) console.log(`\nTemporary passwords written to ${OUT} (not printed). Hand them out, then delete the file.`);
  await base.$disconnect();
}
