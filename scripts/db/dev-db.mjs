// Local throwaway PostgreSQL for development and end-to-end verification (never real data).
//
//   node scripts/db/dev-db.mjs            start (keeps running), migrate, seed; writes .tmp/dev-db.env
//
// .tmp/dev-db.env holds DATABASE_URL for the embedded server (role app_owner, which behaves like
// Supabase's "postgres"). Run the app against it with:  node --env-file=.tmp/dev-db.env …
// Requires SEED_DEMO_PASSWORD in the environment (or .env).
import "dotenv/config";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { startTestDatabase } from "../../tests/support/embedded-db.mjs";

const port = Number(process.env.DEV_DB_PORT || 54340);
const db = await startTestDatabase({ port, dir: ".tmp/pg-dev", database: "hms_dev" });
const env = { ...process.env, DATABASE_URL: db.url };
try {
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  execSync("node prisma/seed.js", { env, stdio: "inherit" });
} catch (e) {
  console.error("Setup failed:", e.message);
  await db.stop();
  process.exit(1);
}
fs.mkdirSync(".tmp", { recursive: true });
fs.writeFileSync(".tmp/dev-db.env", `DATABASE_URL=${db.url}\n`, { mode: 0o600 });
console.log(`\nDev database ready on port ${port}. DATABASE_URL written to .tmp/dev-db.env. Ctrl+C to stop.`);
const stop = async () => { await db.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
