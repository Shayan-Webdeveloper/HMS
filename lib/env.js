import "server-only";

// Production safety checks for configuration. Values are never logged.

const PLACEHOLDER = /^(replace|change|your|example|placeholder|secret|todo|xxx)/i;

/** Throws if AUTH_SECRET is missing, short or an obvious placeholder (production only). */
export function assertAuthSecret(secret = process.env.AUTH_SECRET) {
  if (process.env.NODE_ENV !== "production") return;
  if (!secret || secret.length < 32 || PLACEHOLDER.test(secret)) {
    throw new Error("AUTH_SECRET must be a random value of at least 32 characters in production (see .env.example).");
  }
}

/** Demo accounts (@demo.hms, created by the seed) are refused in production unless explicitly allowed. */
export function isDemoAccountBlocked(email) {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.ALLOW_DEMO_ACCOUNTS === "true") return false;
  return /@demo\.hms$/i.test(String(email || ""));
}
