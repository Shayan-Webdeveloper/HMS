// Create (or reset) a Platform Administrator — the role ABOVE hospitals that registers hospitals and
// appoints their administrators. It has no access to any hospital's records.
//
//   PLATFORM_ADMIN_EMAIL=ops@example.org PLATFORM_ADMIN_NAME="Ops Lead" PLATFORM_ADMIN_PASSWORD="…" npm run create-platform-admin
//
// The account must not be a member of any hospital (keep platform and hospital duties separate).
import "dotenv/config";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../lib/db/client-factory.js";

const email = (process.env.PLATFORM_ADMIN_EMAIL || "").trim().toLowerCase();
const name = (process.env.PLATFORM_ADMIN_NAME || "").trim();
const password = process.env.PLATFORM_ADMIN_PASSWORD || "";

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Set PLATFORM_ADMIN_EMAIL to a valid email address.");
if (name.length < 2) fail("Set PLATFORM_ADMIN_NAME.");
if (password.length < 14 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) fail("PLATFORM_ADMIN_PASSWORD must be at least 14 characters and include a letter and a number.");
if (/@demo\.hms$/i.test(email)) fail("Demo addresses (@demo.hms) cannot be used for real accounts.");

const prisma = createPrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, _count: { select: { memberships: true } } } });
  if (existing?._count.memberships) fail("This account is a member of a hospital. Use a separate account for platform administration.");
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, isActive: true, platformRole: "PLATFORM_ADMIN", failedLoginCount: 0, lockedUntil: null },
    create: { email, name, passwordHash, platformRole: "PLATFORM_ADMIN" },
  });
  await prisma.auditLog.create({ data: { hospitalId: null, userId: user.id, action: "system.create_platform_admin", entityType: "User", entityId: user.id } });
  console.log(`✔ Platform Administrator ready: ${email}`);
  console.log("  Remove PLATFORM_ADMIN_PASSWORD from your environment/.env now that the account exists.");
} finally {
  await prisma.$disconnect();
}
