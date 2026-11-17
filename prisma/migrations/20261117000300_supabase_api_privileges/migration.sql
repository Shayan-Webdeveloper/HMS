-- Part 3 — Supabase Data API privileges.
--
-- Findings before this migration (live audit): RLS was enabled on all 68 public tables with zero
-- policies, while `anon` and `authenticated` held SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
-- TRIGGER on every table, and Supabase's default privileges granted them ALL on any future table.
-- The application never uses these roles: it has no Supabase client SDK, no browser-side database
-- access and its own server-side authentication. RLS with no policy already denied row access, but
-- TRUNCATE is not subject to RLS and the grants were one mistaken policy away from exposing data.
--
-- This migration removes the API roles' access to the application's schema. It is guarded so it is a
-- no-op on plain PostgreSQL (where these roles do not exist). It does NOT touch:
--   * service_role / postgres / supabase_* roles (Supabase-managed; the dashboard and Storage use them);
--   * public.rls_auto_enable() itself or its `ensure_rls` event trigger (Supabase-managed: keeps
--     auto-enabling RLS on new tables). Only the direct EXECUTE grant to PUBLIC/anon/authenticated is
--     removed — the function returns `event_trigger`, so it can only ever run as an event trigger, and
--     event triggers do not need callers to hold EXECUTE (verified in tests/integration).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- Future objects created by this (migration) role must not be auto-granted to the API roles.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA hms_internal FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Functions created by this role are no longer executable by PUBLIC by default.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable' AND p.pronargs = 0) THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM %I', r);
      END IF;
    END LOOP;
  END IF;
END $$;
