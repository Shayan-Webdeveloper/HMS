// Restore a JSON backup made by scripts/db/backup.mjs into a database whose schema matches the
// backup (i.e. the same migrations applied). Refuses to write into tables that already contain data.
//
//   RESTORE_DATABASE_URL=postgres://... node scripts/db/restore.mjs backups/<dir>
//
// The connection must be allowed to set session_replication_role (superuser), so foreign keys and
// triggers are not re-evaluated row by row while the snapshot is loaded in a single transaction.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export async function restoreBackup(dir, url, { skip = [] } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const c = new pg.Client({ connectionString: url, options: "-c TimeZone=UTC" });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    for (const table of Object.keys(manifest.tables)) {
      if (skip.includes(table) || manifest.tables[table] === 0) continue;
      const { rows } = await c.query(`SELECT EXISTS (SELECT 1 FROM public."${table}") AS has`);
      if (rows[0].has) throw new Error(`Refusing to restore: table "${table}" is not empty.`);
      const data = fs.readFileSync(path.join(dir, `${table}.json`), "utf8");
      await c.query(`INSERT INTO public."${table}" SELECT * FROM json_populate_recordset(NULL::public."${table}", $1::json)`, [data]);
    }
    await c.query("COMMIT");
    return manifest;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.endsWith("restore.mjs")) {
  const dir = process.argv[2];
  const url = process.env.RESTORE_DATABASE_URL;
  if (!dir || !url) { console.error("Usage: RESTORE_DATABASE_URL=... node scripts/db/restore.mjs <backupDir>"); process.exit(1); }
  const m = await restoreBackup(path.resolve(dir), url);
  console.log(`Restored ${Object.keys(m.tables).length} tables from ${dir}`);
}
