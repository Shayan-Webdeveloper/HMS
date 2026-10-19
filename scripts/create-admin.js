// Bootstrap a Super Administrator for a fresh (non-demo) installation.
//
//   ADMIN_EMAIL=you@hospital.org ADMIN_NAME="Your Name" ADMIN_PASSWORD='a-strong-password-123' npm run create-admin
//   (or set those three in .env)
//
// Safe to re-run: it creates missing roles/permissions (never removes custom grants), creates the
// hospital record if none exists, and creates the admin or resets their password + re-activates them.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../lib/db/client-factory.js";
import { ROLES, PERMISSIONS } from "../lib/permissions/matrix.js";

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const name = (process.env.ADMIN_NAME || "").trim();
const password = process.env.ADMIN_PASSWORD || "";

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Set ADMIN_EMAIL to a valid email address.");
if (name.length < 2) fail("Set ADMIN_NAME.");
if (password.length < 12 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) fail("ADMIN_PASSWORD must be at least 12 characters and include a letter and a number.");

const prisma = createPrismaClient();
try {
  // Permissions & roles (additive only)
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    const [resource, action] = key.split(":");
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key, resource, action, description } });
  }
  const perms = Object.fromEntries((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  for (const [key, r] of Object.entries(ROLES)) {
    const existing = await prisma.role.findUnique({ where: { key } });
    if (existing) continue; // never overwrite grants an administrator may have customised
    const role = await prisma.role.create({ data: { key, name: r.name, description: r.description } });
    await prisma.rolePermission.createMany({ data: r.permissions.map((p) => ({ roleId: role.id, permissionId: perms[p] })) });
  }
  // SUPER_ADMIN must always hold user and settings management
  const sa = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  for (const k of ["users:manage", "settings:manage", "audit:read"]) {
    await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: sa.id, permissionId: perms[k] } }, update: {}, create: { roleId: sa.id, permissionId: perms[k] } });
  }
  // Hospital record
  if (!(await prisma.hospital.findFirst())) {
    const h = await prisma.hospital.create({ data: { name: process.env.HOSPITAL_NAME || "My Hospital", code: process.env.HOSPITAL_CODE || "HOSP", timezone: process.env.HOSPITAL_TIMEZONE || "Asia/Karachi", currency: process.env.HOSPITAL_CURRENCY || "PKR" } });
    await prisma.facility.create({ data: { hospitalId: h.id, name: "Main Campus", code: "MAIN" } });
    console.log(`• Created hospital "${h.name}" — update details in Settings.`);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, isActive: true, failedLoginCount: 0, lockedUntil: null },
    create: { email, name, passwordHash },
  });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: sa.id } }, update: {}, create: { userId: user.id, roleId: sa.id } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "system.create_admin", entityType: "User", entityId: user.id } });
  console.log(`✔ Super Administrator ready: ${email}`);
  console.log("  Remove ADMIN_PASSWORD from your environment/.env now that the account exists.");
} finally {
  await prisma.$disconnect();
}
