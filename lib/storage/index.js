import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Private file storage abstraction. Files are never publicly reachable: they are only served through
// the authorised route handler GET /api/documents/[id], which checks hospital, patient and
// document-category permissions first.
//
// Providers (FILE_STORAGE_PROVIDER):
//   "local"    → files under FILE_STORAGE_LOCAL_DIR, outside /public (development; not persistent on
//                serverless hosts such as Vercel).
//   "supabase" → a PRIVATE Supabase Storage bucket, accessed only from the server with the
//                service-role key (never sent to browsers). Create it with `npm run storage:setup`.
//
// Every object key starts with the owning hospital's id ("<hospitalId>/<yyyy-mm>/<uuid>.<ext>"), and
// reads verify that prefix, so a key from one hospital can never be fetched in another's context.

export const ALLOWED_TYPES = {
  "application/pdf": { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
};

export const MAX_BYTES = Number(process.env.FILE_MAX_BYTES || 10 * 1024 * 1024);

const HOSPITAL_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function sniffType(buf) {
  for (const [mime, { magic }] of Object.entries(ALLOWED_TYPES)) {
    if (magic.every((b, i) => buf[i] === b)) return mime;
  }
  return null;
}

export function safeFilename(name) {
  return String(name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
}

function provider() {
  return process.env.FILE_STORAGE_PROVIDER || "local";
}

function assertKey(key, hospitalId) {
  if (!HOSPITAL_ID.test(String(hospitalId || ""))) throw new Error("Invalid hospital for storage access");
  if (typeof key !== "string" || !key.startsWith(`${hospitalId}/`) || key.includes("..") || key.includes("\\")) {
    throw new Error("Storage key does not belong to this hospital");
  }
}

// ── local ────────────────────────────────────────────────
function baseDir() {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.FILE_STORAGE_LOCAL_DIR || "./storage/uploads");
}
function localPath(key) {
  const base = baseDir();
  const full = path.join(/* turbopackIgnore: true */ base, key);
  if (!full.startsWith(base + path.sep)) throw new Error("Invalid storage key");
  return full;
}

// ── supabase ─────────────────────────────────────────────
function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "hms-documents";
  if (!url || !key) throw new Error("Supabase storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). See README → Storage.");
  return { url, key, bucket, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}
const objectUrl = (c, key) => `${c.url}/storage/v1/object/${encodeURIComponent(c.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** Store bytes for `hospitalId`. Returns { key, sha256 }. */
export async function putFile(buf, mime, { hospitalId } = {}) {
  if (!HOSPITAL_ID.test(String(hospitalId || ""))) throw new Error("putFile requires the owning hospitalId");
  const key = `${hospitalId}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ALLOWED_TYPES[mime].ext}`;
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const p = provider();
  if (p === "local") {
    const full = localPath(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buf, { mode: 0o600 });
  } else if (p === "supabase") {
    const c = supabaseConfig();
    const res = await fetch(objectUrl(c, key), { method: "POST", headers: { ...c.headers, "Content-Type": mime, "x-upsert": "false" }, body: buf });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
  } else {
    throw new Error(`Storage provider "${p}" is not implemented. See README → Storage.`);
  }
  return { key, sha256 };
}

/** Read bytes of `key`, which must belong to `hospitalId`. */
export async function getFile(key, { hospitalId } = {}) {
  assertKey(key, hospitalId);
  const p = provider();
  if (p === "local") return fs.readFile(localPath(key));
  if (p === "supabase") {
    const c = supabaseConfig();
    const res = await fetch(objectUrl(c, key), { headers: c.headers, cache: "no-store" });
    if (!res.ok) throw new Error(`Storage download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`Storage provider "${p}" is not implemented.`);
}

/** Best-effort removal (used to clean up after a failed database write). */
export async function removeFile(key, { hospitalId } = {}) {
  assertKey(key, hospitalId);
  const p = provider();
  if (p === "local") { await fs.rm(localPath(key), { force: true }); return; }
  if (p === "supabase") {
    const c = supabaseConfig();
    await fetch(`${c.url}/storage/v1/object/${encodeURIComponent(c.bucket)}`, { method: "DELETE", headers: { ...c.headers, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [key] }) });
  }
}
