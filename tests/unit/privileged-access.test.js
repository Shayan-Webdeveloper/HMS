import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The owner database role (systemPrisma) bypasses row-level security. Every module that may use it is
// listed — with the reason — in docs/SECURITY.md → "Privileged database access". A new use must be
// reviewed and added there (and here) on purpose; it can never appear silently.
const ALLOWED = new Map([
  ["app/api/auth/change-password/route.js", "own account: verify + update password, revoke own sessions"],
  ["app/api/auth/forgot-password/route.js", "pre-authentication: look up account, create reset token"],
  ["app/api/auth/hospital/route.js", "switch the session's active hospital (membership verified first)"],
  ["app/api/auth/login/route.js", "pre-authentication: look up account, lockout counters"],
  ["app/api/auth/reset-password/route.js", "pre-authentication: consume reset token, set password"],
  ["app/api/health/route.js", "SELECT 1 liveness probe, no table access"],
  ["lib/audit.js", "platform-level audit rows (hospitalId NULL) only"],
  ["lib/auth/rate-limit.js", "global pre-authentication rate-limit buckets"],
  ["lib/auth/session.js", "sessions and a user's memberships across hospitals"],
  ["lib/services/platform.js", "Platform Administrator console (hospitals, admins, platform audit)"],
  ["lib/services/staff.js", "global email-uniqueness check (existence only)"],
  ["lib/services/users.js", "global email-uniqueness check and other-hospital membership count (counts only)"],
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(m?js|jsx)$/.test(e.name) ? [p.replace(/\\/g, "/")] : [];
  });
}

describe("privileged (owner role) database access", () => {
  const users = [...walk("app"), ...walk("lib"), ...walk("components")]
    .filter((f) => f !== "lib/db/prisma.js")
    .filter((f) => /import\s*\{[^}]*\bsystemPrisma\b[^}]*\}\s*from\s*"@\/lib\/db\/prisma"/.test(fs.readFileSync(f, "utf8")));

  it("is used only by the reviewed modules", () => {
    const unexpected = users.filter((f) => !ALLOWED.has(f));
    expect(unexpected, "New systemPrisma use: review it and document it in docs/SECURITY.md").toEqual([]);
  });

  it("the reviewed list has no stale entries", () => {
    expect([...ALLOWED.keys()].filter((f) => !users.includes(f))).toEqual([]);
  });

  it("is never imported by client components", () => {
    const client = users.filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));
    expect(client).toEqual([]);
  });
});
