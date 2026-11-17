// Which tables are hospital-owned, derived from the Prisma data model itself (never a hand-kept list).
// A model is hospital-owned when it has a "hospitalId" column. Used by the tenant-scoped Prisma
// client, the SQL generator for RLS/guards, and the tests. Safe to import from scripts.
import { Prisma } from "@prisma/client";

export const GLOBAL_MODELS = ["Hospital", "User", "Session", "PasswordResetToken", "Role", "Permission", "RateLimitBucket"];

let cache;
function models() {
  cache ??= Prisma.dmmf.datamodel.models;
  return cache;
}

/** Names of hospital-owned models (each has a NOT NULL-by-default "hospitalId"). */
export function tenantModels() {
  return models().filter((m) => m.fields.some((f) => f.name === "hospitalId")).map((m) => m.name);
}

/** Prisma client model accessor names (camelCase) of hospital-owned models. */
export function tenantModelKeys() {
  return tenantModels().map((n) => n[0].toLowerCase() + n.slice(1));
}
