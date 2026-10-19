// Non-"server-only" factory for scripts (seed, tests, CLI). Never import from client components.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Pin the DB session to UTC. The pg driver sends timestamps without an offset, so a
// server whose default TimeZone is local (e.g. Asia/Karachi) would otherwise store
// instants shifted by the UTC offset. Display conversion happens in lib/utils/time.js.

export function createPrismaClient(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("Database URL missing");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c TimeZone=UTC" }) });
}
