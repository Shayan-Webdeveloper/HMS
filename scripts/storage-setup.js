// Create the PRIVATE Supabase Storage bucket for patient documents (idempotent).
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run storage:setup
// The service-role key is a secret: keep it server-side (never NEXT_PUBLIC_*), never commit it.
import "dotenv/config";

const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "hms-documents";
if (!url || !key) { console.error("✖ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
// Same rule as storageAuthHeaders() in lib/storage (that module is server-only, so it is not imported
// here): new secret keys (sb_secret_…) are not JWTs and go on the apikey header only; a legacy
// service_role JWT keeps apikey + Authorization.
const authHeaders = key.startsWith("sb_secret_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
const headers = { ...authHeaders, "Content-Type": "application/json" };

const get = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers });
if (get.ok) {
  const b = await get.json();
  if (b.public) { console.error(`✖ Bucket "${bucket}" exists but is PUBLIC. Make it private in the Supabase dashboard before use.`); process.exit(1); }
  console.log(`✔ Private bucket "${bucket}" already exists.`);
} else {
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: Number(process.env.FILE_MAX_BYTES || 10485760), allowed_mime_types: ["application/pdf", "image/png", "image/jpeg"] }),
  });
  if (!res.ok) { console.error(`✖ Could not create bucket (${res.status}).`); process.exit(1); }
  console.log(`✔ Created private bucket "${bucket}".`);
}
