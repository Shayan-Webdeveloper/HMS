import crypto from "node:crypto";

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmac(value, secret = process.env.AUTH_SECRET) {
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET must be set (16+ characters).");
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
