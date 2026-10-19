import "server-only";
import { prisma } from "@/lib/db/prisma";
import { tooMany } from "@/lib/errors";

// Fixed-window rate limiter stored in PostgreSQL, so it works across multiple app instances.
export async function rateLimit(key, { limit, windowSeconds }) {
  const resetAt = new Date(Date.now() + windowSeconds * 1000);
  const rows = await prisma.$queryRaw`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" < now() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" < now() THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count"`;
  if (Number(rows[0].count) > limit) throw tooMany();
}
