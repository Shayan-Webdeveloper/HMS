# Security notes (secrets, documents, database, Supabase)

> ⚠️ This system is **not certified** for HIPAA, GDPR, Pakistan's data-protection requirements or any other
> regulatory framework. A real deployment needs independent security, privacy, clinical-safety and legal
> review and a penetration test. The bundled data is synthetic.

Multi-hospital isolation is documented separately in [MULTI_TENANCY.md](MULTI_TENANCY.md).

## 1. Environment secrets and credentials

| Variable | Secret? | Notes |
|---|---|---|
| `DATABASE_URL`, `TEST_DATABASE_URL` | **Yes** (contain the DB password) | server-only |
| `AUTH_SECRET` | **Yes** | ≥ 32 random chars; the server refuses to start in production with a short or placeholder value (`instrumentation.js`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** (bypasses Storage/RLS policies) | server-only, never `NEXT_PUBLIC_*` |
| `EMAIL_SERVER_PASSWORD` | **Yes** | |
| `ADMIN_PASSWORD`, `PLATFORM_ADMIN_PASSWORD` | **Yes** (one-off bootstrap) | remove after use |
| `SEED_DEMO_PASSWORD` | Development secret | demo accounts only; ≥ 12 chars; publicly known values are refused by the seed |
| `APP_URL`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `FILE_STORAGE_*`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`, `SESSION_*`, `ALLOW_DEMO_ACCOUNTS` | No | ordinary configuration |

Changes made:

* `hms-env.txt` (a local settings file containing a real-looking `AUTH_SECRET` and the demo password) was
  **tracked in the public Git repository**. It is now untracked and ignored (`*-env.txt`); the local copy was
  left in place. `.gitignore` now ignores `.env*` (except `.env.example`), `*.pem`, `*.key`, `/storage/`,
  `/backups/`, `.tmp/`, `.vercel`.
* The old ignore rule `storage/` also matched `lib/storage/`, so **the storage module had never been
  committed** and a fresh clone could not build. The rule is now anchored (`/storage/`) and the module is
  committed.
* `.env.example` contains placeholders only and documents which values are secrets.
* The end-to-end test no longer contains a hard-coded fallback password; `docs/CONVENTIONS.md` no longer
  names the demo password.
* **Demo vs production credentials:** demo accounts (`@demo.hms`) are refused at sign-in when
  `NODE_ENV=production` unless `ALLOW_DEMO_ACCOUNTS=true` is set explicitly (only for a public *demo* with
  synthetic data). `create-admin` / `create-platform-admin` refuse `@demo.hms` addresses. The seed refuses
  short or publicly known demo passwords and refuses to run with `NODE_ENV=production`.

### Exposure assessment and rotation (checked without printing any value)

| Value | Where it leaked | Still in use? | Action |
|---|---|---|---|
| `AUTH_SECRET` in `hms-env.txt` | Public GitHub history (commit `be45684`) | **No** — the local `.env` uses a different value, and no code currently signs anything with `AUTH_SECRET` | Treat as burned. Never reuse it. |
| `AUTH_SECRET` in the local `.env` | Was equal to the public placeholder from `.env.example` | Local only | **Rotated 2026-11-19** to a new random value (verified: no longer the placeholder). Vercel has its own random value generated at first deployment. |
| `SEED_DEMO_PASSWORD` in `hms-env.txt` (also hard-coded in the old e2e test) | Public GitHub history | **No** — re-verified 2026-11-19 against all 27 account hashes in the live database: it matches none | Treat as public; the seed now refuses it. |
| Supabase database password | Not committed (only in the untracked `.env`) | Yes | Rotate if `.env` was ever shared; otherwise no action. The `DATABASE_URL` in `hms-env.txt` pointed at `localhost` with a placeholder password (re-verified: different host, user and password from the live one). |

The repository is **public**. `hms-env.txt` is reachable from `main` and every branch created after commit
`be45684` (it was deleted in `9fab7cf`). No other tracked file contains environment values: only
`.env.example` (placeholders) is tracked, and `.gitignore` excludes `.env`, `.env.*` and `*.env.txt`.

### Git history

Removing a file from the latest commit does **not** remove it from earlier commits, clones, forks or
GitHub's caches. Because nothing in the leaked file is still in use, rotating/abandoning the values is
sufficient and **history was not rewritten**. If you still want it purged:

```bash
pip install git-filter-repo
git filter-repo --invert-paths --path hms-env.txt   # rewrites every commit hash
git push --force --all && git push --force --tags
```

Consequences: every commit id changes; every collaborator must re-clone (old clones would re-introduce
the file); open PRs break; GitHub may keep cached views until you ask GitHub Support to purge them; forks
are unaffected. Do this only with explicit agreement — it was not done automatically.

## 2. Document authorisation

Before: anyone with `patients:read` **or** `clinical:read` could download every patient document, and any
one of five unrelated permissions allowed uploading any category.

Now (`lib/services/documents.js`, rules in `lib/permissions/documents.js`):

| Category | Permission group | Read (default roles) | Upload (default roles) |
|---|---|---|---|
| Referral, Discharge summary | `documents.clinical` | Doctor, Nurse, Super Admin | Doctor, Receptionist (referrals brought in), Super Admin |
| Lab report | `documents.lab` | Lab technician, Doctor, Nurse, Super Admin | Lab technician, Super Admin |
| Imaging report / attachments | `documents.imaging` | Radiology, Doctor, Nurse, Super Admin | Radiology, Super Admin |
| Insurance | `documents.insurance` | Accountant, Receptionist, Hospital Admin, Super Admin | same |
| ID document | `documents.identity` | Receptionist, Hospital Admin, Super Admin | same |
| Consent form | `documents.consent` | Receptionist, Doctor, Nurse, Hospital Admin, Super Admin | Receptionist, Doctor, Nurse, Hospital Admin, Super Admin |
| Other | `documents.other` | Doctor, Nurse, Hospital Admin, Super Admin | Receptionist, Doctor, Hospital Admin, Super Admin |

* `patients:read` / `clinical:read` alone grant **no** document access. Pharmacists and HR have none.
* Every rule also requires the **same hospital** (hospital-scoped lookup + RLS + hospital-prefixed storage key).
* Patients (portal) only get documents of their own verified record; imaging attachments only once the
  report is verified.
* Listings (patient profile, imaging attachments, portal) only show what the user may download — file
  names can be sensitive too. Upload pickers only offer allowed categories.
* All refusals of a download are `404` (existence is not revealed) and are audited (`document.download_denied`).
* Uploads: content-sniffed PDF/PNG/JPEG only, size limit, safe file names, private storage, cleanup of the
  stored object if the database write fails. Downloads carry `Content-Security-Policy: sandbox`, `nosniff`
  and `Cache-Control: private, no-store`.
* Migration `20261117000400_document_permissions` adds the permissions and these default grants in every
  existing hospital; administrators can adjust them per hospital in Settings → Roles.

## 3. Supabase database security

Findings (live database, read-only inspection):

* The app connects with Prisma as `postgres` through the Supabase pooler. That role has **BYPASSRLS**, so
  RLS was never applied to the application. No browser code talks to Supabase (no `@supabase/*` package,
  no anon key); the Supabase Data API is **not used** by the application.
* 68 tables with RLS enabled and **no policies** (deny-all for API roles) — but `anon` and `authenticated`
  held every table privilege including `TRUNCATE` (which RLS does not restrict), and Supabase default
  privileges granted them `ALL` on future tables.
* `public.rls_auto_enable()` is Supabase's `SECURITY DEFINER` event-trigger function (event trigger
  `ensure_rls`) that enables RLS on new tables. It was executable by `PUBLIC`, `anon` and `authenticated`.
  Because it returns `event_trigger`, PostgreSQL refuses to call it directly, so the practical risk was low.

Changes:

* `20261117000300_supabase_api_privileges`: revokes all table/sequence/function privileges of `anon` and
  `authenticated` in `public` and their default privileges for objects created by the migration role;
  removes `PUBLIC`/`anon`/`authenticated` `EXECUTE` on `rls_auto_enable()` **without** dropping the
  function or its event trigger (tested: RLS is still auto-enabled on new tables). `service_role`,
  `postgres` and `supabase_*` are untouched. The migration is a no-op on plain PostgreSQL.
* `20261117000200_tenant_isolation_rls`: real RLS policies for hospital isolation, enforced through the
  restricted role `hms_app` (see MULTI_TENANCY.md). No blanket "allow all" policies on hospital data.

* `20261119000000_current_hospital_id_search_path`: regenerated tenant-security SQL. The only change is
  `hms_internal.current_hospital_id()`: explicit `SECURITY INVOKER` (it must read the *caller's*
  `app.hospital_id`), `SET search_path = pg_catalog`, and a schema-qualified `pg_catalog.current_setting`
  call — fixes the Security Advisor warning "Function Search Path Mutable". Policies call it as
  `(SELECT hms_internal.current_hospital_id())`, evaluated once per statement, so the `SET` clause adds no
  per-row cost. Tested as `hms_app`, including that a `current_setting` planted on the caller's
  `search_path` cannot hijack it.

**Data API: disabled** (Supabase dashboard → Integrations → Data API → "Enable Data API" off, verified
2026-11-19; `/rest/v1/` answers 503). No schema is exposed. The app never uses it: there is no
`@supabase/*` client, no browser-side Supabase access, and no `NEXT_PUBLIC_SUPABASE_*` variable. File
storage uses the separate Storage API from the server only (`lib/storage`). If the Data API is ever
re-enabled, expose only a dedicated schema — never `public`. Default privileges owned by `supabase_admin`
cannot be changed by the `postgres` role; the revoke above covers objects created by the app's migrations.

Security Advisor after these changes: see docs/STATUS.md (verification). The three "RLS Enabled No Policy"
notices (`PasswordResetToken`, `RateLimitBucket`, `_prisma_migrations`) are intentional: RLS without a
policy means deny-all for `hms_app`/`anon`/`authenticated`; only the server's owner role uses them.

### Privileged database access (owner role, `BYPASSRLS`)

There is one connection (Supabase `postgres` via the pooler). Hospital-scoped work switches to `hms_app`
with **transaction-local** `set_config` (ends at COMMIT/ROLLBACK, so the transaction pooler cannot carry a
hospital into another request — covered by a database test). `systemPrisma` is that connection *without*
the switch. Every module allowed to use it is pinned by `tests/unit/privileged-access.test.js`:

| Category | Why the owner role is needed | Where |
|---|---|---|
| Pre-authentication | No user/hospital is known yet; accounts are global | `api/auth/login`, `forgot-password`, `reset-password`, `lib/auth/rate-limit.js` |
| Own account | Update own password, revoke own sessions | `api/auth/change-password` |
| Sessions & memberships | A user's memberships span hospitals; the session decides the hospital | `lib/auth/session.js` (session CRUD, `activeMemberships`), `api/auth/hospital` (session update) |
| Global uniqueness / counts | Emails are unique across hospitals; existence or count only, never data | `lib/services/staff.js`, `lib/services/users.js` |
| Platform administration | Works above hospitals (Platform Administrators only, `route({ platform: true })`) | `lib/services/platform.js` |
| Platform-level audit | Rows with `hospitalId` NULL | `lib/audit.js` |
| Liveness | `SELECT 1`, no table access | `api/health` |
| Maintenance (not app runtime) | Migrations, seed, bootstrap scripts | `prisma/migrations`, `prisma/seed.js`, `scripts/*` |

Moved to `hms_app` on 2026-11-19: the per-request role/permission/staff/patient lookup
(`loadHospitalAccess`, now run inside the chosen hospital's context) and audit rows that belong to a known
hospital (sign-in, hospital switch). Remaining owner-role queries touch only identity tables (`User`,
`Session`, `PasswordResetToken`, `RateLimitBucket`, `HospitalMembership`), `Hospital`, and platform audit rows.

**Plan for a dedicated login role (not yet done — needs a new secret and a Vercel change):**
1. Create `hms_system` (`LOGIN NOBYPASSRLS NOSUPERUSER`) with a strong password; `GRANT hms_app TO hms_system`.
2. Grant it only the identity tables above (SELECT/INSERT/UPDATE/DELETE as each use needs), SELECT/INSERT/
   UPDATE on `Hospital`, INSERT on `AuditLog`, and add RLS policies `TO hms_system` for those tables.
3. Platform hospital provisioning writes hospital-owned rows: run it inside `runWithTenant` for the new
   hospital (as `hms_app`) instead of the owner role.
4. Add `DATABASE_URL` for `hms_system` (pooler user `hms_system.<project-ref>`) in Vercel and `.env`; keep
   the `postgres` URL only for `prisma migrate deploy` and scripts (e.g. `MIGRATION_DATABASE_URL`).
5. Rehearse with `scripts/db/verify-migrations.mjs`, run `npm run test:db` + e2e, deploy, then confirm with
   `select current_user` in `/api/health` that runtime no longer uses `postgres`.

## 4. Referential integrity

`20261117000000_actor_foreign_keys` adds foreign keys for 32 reference columns that had none
(`createdById`, `recordedById`, `authorId`, `finalizedById`, `decidedById`, `updatedById`, `assignedById`,
`administeredById`, `collectedById`, `enteredById`, `validatedById`, `releasedById`, `requestedById`,
`reportedById`, `verifiedById`, `receivedById`, `approvedById`, `performedById`, `uploadedById`,
`triagedById`, `assignedClinicianId` → `User`; `Procedure.surgeonId` → `DoctorProfile`;
`NursingNote.admissionId` → `Admission`; `Patient.mergedIntoId` → `Patient`).

* `ON DELETE RESTRICT` (users and clinical rows are never hard-deleted, attribution must never be lost),
  `ON UPDATE CASCADE`.
* The migration first checks every column for orphaned values and **aborts without changing anything**,
  listing the offending columns, if any exist. Nothing is deleted or nulled automatically. The live data
  had **0** orphans.
* Hospital-owned rows can only reference rows of the same hospital (triggers) and every hospital-owned
  table references `Hospital`.

## 5. Indexes

* **Unindexed foreign keys: 44 → 0.** Every foreign key now has an index whose leading columns are the FK
  columns (measured with a catalogue query before and after).
* **Tenant indexes:** list/filter indexes now lead with `hospitalId` (e.g. `Patient(hospitalId, status,
  registeredAt)`, `Appointment(hospitalId, startsAt)`), replacing the old global ones; each hospital-owned
  table has an index usable for its `hospitalId` foreign key and RLS predicate.
* **Unused indexes were not dropped.** The live database's statistics have never been reset and it holds a
  small demo data set with little traffic, so "never scanned" is not evidence that an index is useless.
  The flagged indexes back real query paths (status filters, date ranges, look-ups by patient/doctor) and
  unique constraints. Re-evaluate after a few weeks of real traffic with `pg_stat_user_indexes`.
* Redundant indexes were avoided (e.g. no separate `(hospitalId)` index where a unique/composite index
  already starts with `hospitalId`). Write overhead: about 110 additional B-tree indexes in total, which is
  modest for this workload; the hottest write paths (appointments, invoices, stock ledger) each gained 2–4.

## 6. Remaining risks / known limitations

* The connection role still has `BYPASSRLS`; `systemPrisma` uses it for authentication, sessions and
  platform administration (inventory and transition plan in §3 "Privileged database access"). A bug in
  that small, test-pinned code is not stopped by RLS until the dedicated `hms_system` role is introduced.
* `hms-env.txt` remains in the public Git history (no active value in it); see §1 for the optional purge.
* Standalone queries cost an extra round trip for the database context (see MULTI_TENANCY.md).
* `User` rows are global: a hospital administrator can rename/reset only accounts that belong *only* to
  their hospital; shared accounts are managed by a Platform Administrator.
* Local file storage is not persistent on serverless hosts — use `FILE_STORAGE_PROVIDER=supabase` on Vercel.
* No malware scanning of uploads; no DICOM/PACS.
