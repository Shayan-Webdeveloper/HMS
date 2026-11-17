// Logical JSON backup of every table in the public schema (data only, plus migration history).
//
//   node scripts/db/backup.mjs [outputDir]        (uses DATABASE_URL; read-only)
//
// Output: backups/<timestamp>/<Table>.json (one JSON array per table) and manifest.json with row
// counts and the applied Prisma migrations. Backups contain patient data — they are git-ignored and
// must be stored as securely as the database itself. Restore with scripts/db/restore.mjs.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (or BACKUP_DATABASE_URL)."); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.resolve(process.argv[2] || path.join("backups", stamp));
fs.mkdirSync(out, { recursive: true, mode: 0o700 });

const c = new pg.Client({ connectionString: url, options: "-c TimeZone=UTC" });
await c.connect();
try {
  // One REPEATABLE READ snapshot so all tables are mutually consistent.
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const { rows: tables } = await c.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const manifest = { createdAt: new Date().toISOString(), tables: {} };
  for (const { tablename } of tables) {
    const { rows } = await c.query(`SELECT coalesce(json_agg(t), '[]'::json) AS data FROM public."${tablename}" t`);
    fs.writeFileSync(path.join(out, `${tablename}.json`), JSON.stringify(rows[0].data), { mode: 0o600 });
    manifest.tables[tablename] = rows[0].data.length;
  }
  await c.query("COMMIT");
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`Backed up ${Object.keys(manifest.tables).length} tables (${total} rows) to ${out}`);
} finally {
  await c.end();
}
