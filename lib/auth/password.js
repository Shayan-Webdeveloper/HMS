import bcrypt from "bcryptjs";

const COST = 12;

export const PASSWORD_POLICY_TEXT = "At least 10 characters, including a letter and a number.";

export function validatePasswordStrength(pw) {
  if (typeof pw !== "string" || pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 128) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must include at least one letter and one number.";
  return null;
}

export async function hashPassword(pw) {
  return bcrypt.hash(pw, COST);
}

export async function verifyPassword(pw, hash) {
  if (!hash) return false;
  return bcrypt.compare(pw, hash);
}

// Used to keep login timing similar when the e-mail does not exist.
let dummyHashPromise;
export function dummyHash() {
  dummyHashPromise ??= bcrypt.hash("timing-equaliser-not-a-password", COST);
  return dummyHashPromise;
}
