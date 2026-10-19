import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Pin the DB session to UTC. The pg driver sends timestamps without an offset, so a
// server whose default TimeZone is local (e.g. Asia/Karachi) would otherwise store
// instants shifted by the UTC offset. Display conversion happens in lib/utils/time.js.

// One PrismaClient per server process (reused across hot reloads in development).
const globalForPrisma = globalThis;

function createClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const prisma = globalForPrisma.__hmsPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__hmsPrisma = prisma;
