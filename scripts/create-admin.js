// Bootstrap the first administrator of a hospital for a fresh (non-demo) installation.
//
//   ADMIN_EMAIL=you@hospital.org ADMIN_NAME="Your Name" ADMIN_PASSWORD="a-strong-password-123" \
//   HOSPITAL_CODE=CITY HOSPITAL_NAME="City Hospital" npm run create-admin
//   (or set them in .env; remove ADMIN_PASSWORD afterwards)
//
// Safe to re-run. It ensures the role/permission catalogue exists (never removes custom grants),
// creates the hospital if no hospital with HOSPITAL_CODE exists (or uses the only hospital when
// HOSPITAL_CODE is empty), then creates the admin — or resets their password — and gives them the
// hospital-level Super Administrator role IN THAT HOSPITAL ONLY. Use `npm run create-platform-admin`
// for the Platform Administrator, which manages hospitals.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../lib/db/client-factory.js";
import { ensurePermissionCatalogue, provisionHospital, grantMembership } from "../lib/tenancy/provision.js";

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const name = (process.env.ADMIN_NAME || "").trim();
const password = process.env.ADMIN_PASSWORD || "";
const code = (process.env.HOSPITAL_CODE || "").trim().toUpperCase();

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Set ADMIN_EMAIL to a valid email address.");
if (name.length < 2) fail("Set ADMIN_NAME.");
if (password.length < 12 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) fail("ADMIN_PASSWORD must be at least 12 characters and include a letter and a number.");
if (/@demo\.hms$/i.test(email)) fail("Demo addresses (@demo.hms) cannot be used for real administrator accounts.");

// Owner-role client: this script works before any hospital context exists and sets hospitalId explicitly.
const prisma = createPrismaClient();
try {
  await ensurePermissionCatalogue(prisma);
  let hospital;
  if (code) {
    hospital = await prisma.hospital.findUnique({ where: { code } });
    if (!hospital) {
      hospital = await provisionHospital(prisma, { name: process.env.HOSPITAL_NAME || "My Hospital", code, timezone: process.env.HOSPITAL_TIMEZONE || "Asia/Karachi", currency: process.env.HOSPITAL_CURRENCY || "PKR" });
      console.log(`• Created hospital "${hospital.name}" (${hospital.code}) — update details in Settings.`);
    }
  } else {
    const all = await prisma.hospital.findMany({ take: 2 });
    if (all.length > 1) fail("Several hospitals exist: set HOSPITAL_CODE to choose one.");
    hospital = all[0] ?? await provisionHospital(prisma, { name: process.env.HOSPITAL_NAME || "My Hospital", code: "HOSP" });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, isActive: true, failedLoginCount: 0, lockedUntil: null },
    create: { email, name, passwordHash },
  });
  if (user.platformRole) fail("This email belongs to a Platform Administrator; use a separate account for hospital administration.");
  await grantMembership(prisma, { hospitalId: hospital.id, userId: user.id, roleKeys: ["SUPER_ADMIN"] });
  await prisma.auditLog.create({ data: { hospitalId: hospital.id, userId: user.id, action: "system.create_admin", entityType: "User", entityId: user.id } });
  console.log(`✔ Super Administrator of ${hospital.name} ready: ${email}`);
  console.log("  Remove ADMIN_PASSWORD from your environment/.env now that the account exists.");
} finally {
  await prisma.$disconnect();
}
