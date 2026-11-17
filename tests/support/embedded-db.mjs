// Disposable PostgreSQL 17 for integration tests and local verification (never a real database).
//
// It emulates the parts of Supabase that matter for security testing:
//   * `app_owner` — a NON-superuser login role with CREATEROLE + BYPASSRLS, like Supabase's `postgres`.
//     The app and the migrations connect as this role, exactly as they do in production.
//   * `anon`, `authenticated` (no BYPASSRLS) and `service_role` (BYPASSRLS), with Supabase's default
//     privileges that grant them ALL on every new table in `public`.
//   * Supabase's `public.rls_auto_enable()` event trigger, which enables RLS on every new table.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export const OWNER = "app_owner";

const RLS_AUTO_ENABLE = `
CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
DECLARE cmd record; tbl name;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IN ('public') THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
      EXCEPTION WHEN OTHERS THEN RAISE LOG 'rls_auto_enable: failed on %', cmd.object_identity;
      END;
    END IF;
  END LOOP;
END; $function$;`;

/**
 * Start a throwaway cluster. Returns { url, superUrl, stop }.
 * `url` connects as the Supabase-like owner role; `superUrl` as the real superuser (setup only).
 */
export async function startTestDatabase({ port = 54329, dir = ".tmp/pg-test", database = "hms_test", keep = false } = {}) {
  const databaseDir = path.resolve(dir);
  fs.rmSync(databaseDir, { recursive: true, force: true });
  const superPassword = crypto.randomBytes(12).toString("hex");
  const ownerPassword = crypto.randomBytes(12).toString("hex");
  const server = new EmbeddedPostgres({ databaseDir, user: "postgres", password: superPassword, port, persistent: keep, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  const superBase = `postgresql://postgres:${superPassword}@localhost:${port}`;

  const admin = new pg.Client({ connectionString: `${superBase}/postgres` });
  await admin.connect();
  await admin.query(`
    CREATE ROLE anon NOLOGIN NOINHERIT;
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    CREATE ROLE ${OWNER} LOGIN PASSWORD '${ownerPassword}' CREATEROLE BYPASSRLS NOSUPERUSER;
    GRANT anon, authenticated, service_role TO ${OWNER};`);
  await admin.query(`CREATE DATABASE ${database} OWNER ${OWNER} ENCODING 'UTF8' TEMPLATE template0`);
  await admin.end();

  const db = new pg.Client({ connectionString: `${superBase}/${database}` });
  await db.connect();
  await db.query(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ${RLS_AUTO_ENABLE}
    ALTER FUNCTION public.rls_auto_enable() OWNER TO ${OWNER};
    GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon, authenticated, service_role;
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') EXECUTE FUNCTION public.rls_auto_enable();`);
  await db.end();

  return {
    url: `postgresql://${OWNER}:${ownerPassword}@localhost:${port}/${database}?schema=public`,
    superUrl: `${superBase}/${database}`,
    async stop() {
      await server.stop();
      if (!keep) fs.rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}
