// Rehearse the production migration on a throwaway copy of real data.
//
//   node scripts/db/verify-migrations.mjs backups/<dir>
//
// 1. Start an embedded PostgreSQL that emulates Supabase roles (tests/support/embedded-db.mjs).
// 2. Apply the migrations that were live when the backup was taken (from its _prisma_migrations).
// 3. Restore the backup, then run `prisma migrate deploy` for the new migrations.
// 4. Verify: every row survived, every hospital-owned row has the right hospital, memberships exist,
//    and the database matches prisma/schema.prisma exactly (no drift).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import pg from "pg";
import { startTestDatabase } from "../../tests/support/embedded-db.mjs";
import { restoreBackup } from "./restore.mjs";

const dir = path.resolve(process.argv[2] || "");
if (!fs.existsSync(path.join(dir, "manifest.json"))) { console.error("Pass a backup directory."); process.exit(1); }
const applied = JSON.parse(fs.readFileSync(path.join(dir, "_prisma_migrations.json"), "utf8")).map((m) => m.migration_name).sort();
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));

const db = await startTestDatabase({ port: 54331, dir: ".tmp/pg-verify" });
const run = (cmd) => execSync(cmd, { stdio: "pipe", env: { ...process.env, DATABASE_URL: db.url } }).toString();
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? "✔" : "✖"} ${msg}`); if (!ok) failed = true; };
try {
  const owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  // Prisma Migrate history table, exactly as Prisma creates it.
  await owner.query(`CREATE TABLE "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
  for (const name of applied) {
    await owner.query(fs.readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
  }
  await owner.end();
  console.log(`Applied ${applied.length} baseline migration(s): ${applied.join(", ")}`);
  await restoreBackup(dir, db.superUrl);
  console.log("Restored backup.");

  const out = run("npx prisma migrate deploy");
  console.log(out.split("\n").filter((l) => /Applying|applied|No pending/.test(l)).join("\n"));

  const c = new pg.Client({ connectionString: db.superUrl });
  await c.connect();
  for (const [table, n] of Object.entries(manifest.tables)) {
    if (table === "_prisma_migrations") continue;
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM public."${table}"`);
    // The document-permission migration only ADDS catalogue rows and grants.
    const grows = table === "Permission" || table === "RolePermission";
    if (grows ? rows[0].n < n : rows[0].n !== n) check(false, `${table}: ${rows[0].n} rows after migration, ${n} before`);
  }
  check(!failed, "every table kept its row count");
  const { rows: hosp } = await c.query(`SELECT id FROM "Hospital"`);
  const { rows: cols } = await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='hospitalId'`);
  let wrong = 0;
  for (const { table_name } of cols) {
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM public."${table_name}" WHERE "hospitalId" IS DISTINCT FROM $1 AND NOT ($2 AND "hospitalId" IS NULL)`, [hosp[0]?.id, table_name === "AuditLog"]);
    if (rows[0].n) { wrong += rows[0].n; console.log(`  ${table_name}: ${rows[0].n} row(s) not assigned to the hospital`); }
  }
  check(wrong === 0, `all rows in ${cols.length} hospital-owned tables belong to the existing hospital`);
  const { rows: mem } = await c.query(`SELECT (SELECT count(DISTINCT "userId") FROM "UserRole")::int AS users, (SELECT count(*) FROM "HospitalMembership")::int AS members`);
  check(mem[0].users === mem[0].members, `memberships created for ${mem[0].members}/${mem[0].users} users with roles`);
  const { rows: rls } = await c.query(`SELECT count(*)::int AS n FROM pg_tables t WHERE schemaname='public' AND tablename <> '_prisma_migrations' AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename) AND tablename NOT IN ('PasswordResetToken','RateLimitBucket')`);
  check(rls[0].n === 0, "every application table has an RLS policy (except auth-only tables, which deny all)");
  const { rows: anon } = await c.query(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated')`);
  check(anon[0].n === 0, "anon / authenticated hold no table privileges");
  await c.end();

  let drift = "";
  try { run("npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code"); }
  catch (e) { drift = e.stdout?.toString() || String(e); }
  check(!drift, "database matches prisma/schema.prisma (no drift)");
  if (drift) console.log(drift.slice(0, 3000));
} finally {
  await db.stop();
}
process.exit(failed ? 1 : 0);
