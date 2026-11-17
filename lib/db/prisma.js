import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createTenantClient, TenantContextError, explicitTenantContext } from "./tenant-client";

// Two clients, one connection pool:
//
//   prisma        Hospital-scoped. Every query is limited to the hospital of the authenticated request,
//                 both in the application (WHERE hospitalId = …) and in PostgreSQL (role hms_app + RLS).
//                 Use it for everything that touches hospital data.
//
//   systemPrisma  The owner role, NOT scoped. Only for code that by definition works across or before
//                 a hospital context: sign-in/session handling, rate limiting, platform administration
//                 and maintenance scripts. Every use must filter explicitly and be reviewed.
//
// The DB session is pinned to UTC: the pg driver sends timestamps without an offset, so a server whose
// default TimeZone is local would otherwise store shifted instants. Display conversion: lib/utils/time.js.

const globalForPrisma = globalThis;

function createBaseClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

// Pages (server components) do not run inside route(): resolve the hospital from the signed-in session.
async function resolveRequestContext() {
  try {
    const { getSession } = await import("@/lib/auth/session");
    const session = await getSession();
    return session?.hospitalId ? { hospitalId: session.hospitalId, userId: session.user.id } : null;
  } catch (e) {
    if (e instanceof TenantContextError) throw e;
    // Outside a request (no cookies available): no context → callers fail closed.
    return null;
  }
}

export const systemPrisma = globalForPrisma.__hmsPrisma ?? createBaseClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__hmsPrisma = systemPrisma;

export const prisma = globalForPrisma.__hmsTenantPrisma ?? createTenantClient(systemPrisma, { resolveContext: resolveRequestContext });
if (process.env.NODE_ENV !== "production") globalForPrisma.__hmsTenantPrisma = prisma;

/** The current request's hospital id (explicit context or the signed-in session), or throws. */
export async function currentHospitalId() {
  const ctx = explicitTenantContext() ?? (await resolveRequestContext());
  if (!ctx?.hospitalId) throw new TenantContextError();
  return ctx.hospitalId;
}

/** Like currentHospitalId() but returns null instead of throwing. */
export async function tryCurrentHospitalId() {
  try { return await currentHospitalId(); } catch { return null; }
}

export { runWithTenant, TenantContextError } from "./tenant-client";
