# Hospital Management System (HMS)

A full-stack, **multi-hospital** hospital management web application: patient registration, scheduling, OPD consultations and EMR, admissions and bed management, emergency, laboratory, radiology, pharmacy, inventory, billing, insurance, HR, reports, and a patient portal. Many independent hospitals share one deployment and one PostgreSQL database, with each hospital's data isolated by the application **and** by PostgreSQL row-level security.

> ⚠️ **Not certified for clinical use.** This software has not been certified under HIPAA, GDPR, Pakistan's data-protection requirements, or any other regulatory framework. A real deployment needs independent **security, privacy, clinical-safety and legal review**, a penetration test, and organisation-specific policies. All bundled data is **synthetic demonstration data**.

- **Feature checklist (what's complete, partial and outstanding):** [`docs/STATUS.md`](docs/STATUS.md)
- **Architecture and key decisions:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Engineering conventions for contributors:** [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)
- **Multi-hospital architecture and isolation:** [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md)
- **Security notes (secrets, documents, Supabase, integrity, indexes):** [`docs/SECURITY.md`](docs/SECURITY.md)

---

## Technology stack

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Route Handlers, Server Components), React 19 |
| Language | **JavaScript only** (`.js` / `.jsx`) — no TypeScript |
| Styling | Tailwind CSS v4 + custom CSS design tokens (`styles/globals.css`) |
| Database | PostgreSQL 14+ (tested on 17, incl. Supabase) with Prisma ORM 7 (`@prisma/adapter-pg`); row-level security for hospital isolation |
| Auth | Server-side database sessions (HttpOnly cookie), bcrypt password hashing, RBAC — see *Authentication* below |
| Forms & validation | React Hook Form + Zod v4 (same schemas on client and server) |
| UI | lucide-react icons, Recharts charts, sonner toasts, native `<dialog>` modals |
| Documents | Print-optimised HTML pages for every clinical/financial document; PDFKit for invoice PDFs |
| Money | `decimal.js` + PostgreSQL `numeric(12,2)` — never floating point |
| Tests | Vitest — unit tests, database isolation tests on an embedded PostgreSQL, HTTP end-to-end tests |

## Prerequisites

- **Node.js 20.9 or newer** (22 LTS recommended) — `node -v`
- **PostgreSQL 14 or newer** running locally or reachable over the network
- Windows, macOS or Linux

## Installation (local development)

```bash
# 1. Install dependencies (also runs `prisma generate`)
npm install

# 2. Configure environment
cp .env.example .env          # Windows PowerShell:  Copy-Item .env.example .env
#    then edit .env — at minimum set DATABASE_URL, AUTH_SECRET and SEED_DEMO_PASSWORD

# 3. Create the database (once), e.g. in psql:
#    CREATE DATABASE hms;

# 4. Apply migrations and load demonstration data
npm run db:deploy
npm run seed

#    No PostgreSQL installed? `node scripts/db/dev-db.mjs` starts a throwaway embedded PostgreSQL,
#    migrates and seeds it, and writes its DATABASE_URL to .tmp/dev-db.env.

# 5. Start the development server
npm run dev                   # http://localhost:3000
```

Sign in with any demo account below, using the password you set in `SEED_DEMO_PASSWORD`. If you left it empty, the seed prints a random password once.

The seed creates **two independent demo hospitals** and a Platform Administrator:

* **Demo General Hospital** (`DGH`, full data set) — the accounts in the table below.
* **Central Hospital (Demo)** (`CEN`, smaller data set) — the same accounts prefixed with `central.`, e.g. `central.admin@demo.hms`, `central.dr.khan@demo.hms`, `central.patient@demo.hms`. Neither hospital can see the other's data.
* `platform@demo.hms` — **Platform Administrator** (`/platform`): registers hospitals and appoints their administrators; no access to hospital records.

| Account | Role (in Demo General Hospital) |
|---|---|
| `admin@demo.hms` | Super Administrator |
| `hadmin@demo.hms` | Hospital Administrator |
| `reception@demo.hms` | Receptionist |
| `dr.khan@demo.hms`, `dr.fatima@demo.hms`, `dr.ahmed@demo.hms`, `dr.malik@demo.hms`, `dr.raza@demo.hms` | Doctors |
| `nurse@demo.hms` | Nurse |
| `lab@demo.hms` | Laboratory Technician |
| `radiology@demo.hms` | Radiology |
| `pharmacy@demo.hms` | Pharmacist |
| `billing@demo.hms` | Accountant / Billing Officer |
| `hr@demo.hms` | HR Manager |
| `patient@demo.hms` | Patient (portal, linked to MRN-000001) |

> Demo accounts are for **development only**. `npm run seed` **wipes the target database** before loading synthetic data, and it refuses to run when `NODE_ENV=production`. In production, `@demo.hms` accounts are refused at sign-in unless `ALLOW_DEMO_ACCOUNTS=true` is set deliberately for a public demo.

## Environment variables

See `.env.example` (placeholders only — never commit `.env`).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (secret). The app switches to the restricted `hms_app` role per transaction for hospital data. On Supabase + Vercel use the transaction pooler (port 6543). |
| `AUTH_SECRET` | ≥ 32 random characters (secret). The server refuses to start in production with a missing or placeholder value. |
| `APP_URL` | Public base URL; used in password-reset links. |
| `SESSION_MAX_AGE_HOURS`, `SESSION_IDLE_MINUTES` | Absolute session lifetime and idle timeout (defaults 12 h / 60 min). |
| `EMAIL_PROVIDER` | `log` (default: emails written to `storage/mail-log/` and the server console) or `smtp`. |
| `EMAIL_FROM`, `EMAIL_SERVER_HOST`, `EMAIL_SERVER_PORT`, `EMAIL_SERVER_USER`, `EMAIL_SERVER_PASSWORD` | SMTP settings when `EMAIL_PROVIDER=smtp`. |
| `FILE_STORAGE_PROVIDER`, `FILE_STORAGE_LOCAL_DIR`, `FILE_MAX_BYTES` | Private document storage: `local` (outside `/public`, development) or `supabase`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | For `FILE_STORAGE_PROVIDER=supabase`. The service-role key is a server-only secret. |
| `ALLOW_DEMO_ACCOUNTS` | `true` only for a public demo with synthetic data; otherwise demo accounts are refused in production. |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, `HOSPITAL_CODE`, `HOSPITAL_NAME` | Used once by `npm run create-admin`. Remove the password afterwards. |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_PASSWORD` | Used once by `npm run create-platform-admin`. Remove the password afterwards. |
| `SEED_DEMO_PASSWORD` | Development-only demo password (≥ 12 chars; never reuse for a real account). |
| `E2E_BASE_URL`, `E2E_PASSWORD` | For `npm run test:e2e`. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run test` | Unit tests (235: money, time zones, CSV safety, permissions, document authorisation, tenant scoping, scheduling, FEFO, billing, state machines, …) |
| `npm run test:db` | 23 database-level isolation tests on a throwaway embedded PostgreSQL (RLS, guards, API roles, pooled-connection safety) — no external database needed |
| `npm run test:e2e` | 65 HTTP tests (cross-module workflow + multi-hospital isolation attacks) against a **running server with demo data** |
| `npm run db:deploy` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate` | Create a new migration after editing `prisma/schema.prisma` (dev only) |
| `npm run seed` | Wipe and load synthetic demo data (dev only) |
| `npm run setup:dev` | `db:deploy` + `seed` |
| `npm run create-admin` | Create/repair the first Super Administrator of a hospital for a real installation |
| `npm run create-platform-admin` | Create/repair a Platform Administrator (manages hospitals) |
| `npm run storage:setup` | Create the private Supabase Storage bucket |
| `npm run db:backup` | JSON backup of every table to `backups/<timestamp>/` (git-ignored; contains patient data) |
| `npm run db:verify-migrations -- <backupDir>` | Rehearse pending migrations on an embedded copy of a backup and verify the result |
| `npm run db:generate-tenant-sql` | Regenerate the RLS / guard SQL from the schema (see docs/MULTI_TENANCY.md) |

### Running the end-to-end tests

```bash
npm run build && npm run start        # in one terminal (database seeded with demo data)
E2E_BASE_URL=http://localhost:3000 E2E_PASSWORD=<your SEED_DEMO_PASSWORD> npm run test:e2e
```

The suite runs the full patient journey. A receptionist registers a patient, the duplicate check fires, an appointment is booked with conflict detection, and a walk-in is checked in. A doctor documents the consultation, prescribes, orders a lab test and finalizes. The lab collects, enters and releases the result (flagged against the configured range). The pharmacy dispenses with stock decrement. Billing builds the invoice from unbilled charges, with idempotent payment and a real PDF. Admissions are tested with a concurrent double-booking of one bed (exactly one wins), then transfer and discharge. It also covers reports and CSV export, patient-portal isolation, cross-site request blocking, and session revocation. Each run creates its own uniquely named patients. Never point it at production.

## Production deployment

### Vercel + Supabase

1. Supabase: use the **transaction pooler** connection string (port 6543) for `DATABASE_URL` in Vercel. Apply migrations from your machine (`npm run db:backup`, then `npm run db:deploy`) — not during the Vercel build.
2. Supabase → Project Settings → Data API: remove `public` from the exposed schemas (the app does not use the Data API).
3. `FILE_STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, then `npm run storage:setup` once (Vercel's file system is not persistent).
4. Vercel → Environment Variables: `DATABASE_URL`, `AUTH_SECRET`, `APP_URL` (the Vercel URL), the storage variables, optional SMTP. Add `ALLOW_DEMO_ACCOUNTS=true` **only** for a demo deployment with synthetic data.
5. Deploy; check `/api/health`.

### Self-hosted

1. Provision PostgreSQL with automated backups and point-in-time recovery (see *Backup & restore*).
2. Create two DB roles: an **owner** for migrations and an **app** login role. The migrations create the restricted `hms_app` role and grant it to the migrating role; if the app connects with a different role, run `GRANT hms_app TO <app role>`.
3. Set the environment variables listed above (real `AUTH_SECRET`, `APP_URL=https://…`, SMTP if wanted). Set `NODE_ENV=production`.
4. `npm ci && npm run build`
5. `DATABASE_URL=<owner url> npm run db:deploy`
6. `PLATFORM_ADMIN_EMAIL=… PLATFORM_ADMIN_NAME=… PLATFORM_ADMIN_PASSWORD=… npm run create-platform-admin`, then register hospitals and appoint their administrators in `/platform` — or bootstrap one hospital directly with `ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD=… HOSPITAL_CODE=… HOSPITAL_NAME=… npm run create-admin`. Do **not** run the seed. Remove the passwords afterwards.
7. `npm run start` behind an HTTPS reverse proxy (nginx, Caddy, IIS ARR…) that sets `X-Forwarded-For` and `X-Forwarded-Host`. Session cookies are `Secure` in production, so HTTPS is required.
8. Sign in, change hospital details in **Settings**, create staff accounts, review the **Roles & permissions** matrix.

`/api/health` returns `200 {"ok":true,"db":"up"}` for load-balancer health checks.

## Administrator account setup

- **Development:** use the seeded `admin@demo.hms` (hospital) and `platform@demo.hms` (platform).
- **Platform Administrator:** `npm run create-platform-admin` — the role above all hospitals (registers hospitals, appoints hospital administrators, resets shared accounts). It cannot see hospital records and must not be a hospital member.
- **Hospital administrators:** appointed in `/platform`, or with `npm run create-admin` (idempotent: creates missing roles/permissions without overwriting customised grants, creates the hospital if needed, creates the admin or resets their password, and grants Super Administrator **in that hospital only**). No default admin account or password exists in the code.
- New users created in **Settings → Users** receive a one-time temporary password and must change it at first sign-in (enforced on pages and APIs).

## User roles

| Role | Highlights |
|---|---|
| **Platform Administrator** (above hospitals) | Registers, deactivates and reactivates hospitals; appoints hospital administrators; resets shared accounts; platform audit. **No** access to any hospital's records. |
| Super Administrator (per hospital) | Everything in **their** hospital except the patient portal; the only hospital role that can edit that hospital's role/permission matrix |
| Hospital Administrator | Operations, staff, settings, users (cannot create Super Admins), reports, billing configuration — read-only clinical access |
| Receptionist | Registration, scheduling, check-in, walk-ins, ER registration, invoice creation and payments |
| Doctor | Consultations, diagnoses, prescriptions, lab/imaging orders, admissions, procedures |
| Nurse | Vitals, nursing notes, medication administration, ward care, triage |
| Laboratory Technician | Specimens, result entry, validation/release, test catalogue |
| Radiology | Imaging workflow, reporting, verification |
| Pharmacist | Medicines, batches, dispensing, returns, stock |
| Accountant / Billing | Invoices, payments, refunds, voids, insurance claims, financial reports |
| HR Manager | Staff records, attendance, leave |
| Patient | Own portal only |

The full matrix (80 permissions, including 14 document-category permissions) lives in `lib/permissions/matrix.js`. Defaults are applied to each hospital when it is created; each hospital edits its **own** grants in **Settings → Roles & permissions**. Roles are granted per hospital, so a role in one hospital gives nothing in another.

## Authentication

Auth.js v5, the release line for current Next.js, was still a beta when this was built. This project therefore uses its own small, auditable session layer (`lib/auth/session.js`):

- Each session token is 256 bits of randomness, stored in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only a SHA-256 hash of the token is stored in the `Session` table.
- Sessions have an absolute lifetime and an idle timeout. Logout, password change and reset, and user deactivation delete session rows, so revocation is immediate.
- Passwords are hashed with bcrypt (cost 12). After 5 failed logins the account locks for 15 minutes. Login, forgot-password and reset are rate-limited using database-backed buckets, so limits hold across instances.
- Password reset uses single-use hashed tokens that expire in 60 minutes, with a response that does not reveal whether an account exists.
- CSRF protection: SameSite cookies plus an Origin check on every state-changing API request.
- `proxy.js` only does an optimistic redirect. **Every page and API re-checks the session and permissions on the server.**

## Storage configuration

`FILE_STORAGE_PROVIDER=local` writes uploads to `FILE_STORAGE_LOCAL_DIR` (default `./storage/uploads`), outside the web root — fine for development, **not persistent on Vercel**. `FILE_STORAGE_PROVIDER=supabase` stores files in a **private** Supabase Storage bucket accessed only by the server (`npm run storage:setup` creates it). Object keys start with the owning hospital's id. Files are only served through `GET /api/documents/[id]`, which checks hospital, document-category permission and patient ownership, and writes an audit log entry (see docs/SECURITY.md). Uploads are validated by size and by **content sniffing** (PDF/PNG/JPEG magic bytes, not the file extension), and stored under random names. To use S3, Azure Blob or another object store, implement `putFile` and `getFile` in `lib/storage/index.js` with the same signatures. Back up the storage directory together with the database.

## Email configuration

`EMAIL_PROVIDER=log` (the default) never sends anything. Messages are written to `storage/mail-log/`, so you can open password-reset links during development. Set `EMAIL_PROVIDER=smtp` plus the `EMAIL_SERVER_*` variables to send real mail through nodemailer. Subjects never contain clinical information, and appointment emails go only to patients who have consented.

## PDF and printing

Every document has a print-optimised page (use the browser's *Print → Save as PDF*): visit summary, prescription, lab report, imaging report, admission summary, discharge summary, invoice, receipt, purchase order, dispensing slip and reports. Invoices can also be downloaded as a generated PDF (`/api/invoices/[id]/pdf`, PDFKit). Documents show only persisted data, hospital branding, document numbers and generation timestamps.

## Security considerations

- **Hospital isolation** at the application layer (hospital-scoped Prisma client) and in PostgreSQL (restricted role `hms_app`, RLS on all 61 hospital-owned tables, cross-hospital reference triggers) — see docs/MULTI_TENANCY.md. The hospital always comes from the server-side session, never from the request.
- Server-side RBAC on every route; ownership in `WHERE` clauses (wrong owner → 404) to prevent IDOR; patients can only reach `/portal` and `/api/portal/*`, scoped to their own record.
- Documents require their category's permission (`documents.<group>:read/upload`), not just patient access.
- Supabase API roles (`anon`, `authenticated`) have no privileges on application tables.
- Audit log for logins, record views, exports, and every clinical or financial change. It records field names and reasons, never clinical free text.
- Finalized encounters are read-only (amendments are appended). Lab corrections keep the original value. Financial records are never deleted (void/refund instead).
- Database CHECK constraints: no negative stock, no over-dispensing, bed occupancy consistent with admissions, refunds ≤ payments.
- CSV exports neutralise spreadsheet formulas and are capped at 5,000 rows. Security headers are set (`X-Frame-Options`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy`).
- No confidential data in `localStorage` (only the sidebar-collapsed preference). Errors return a reference ID, not stack traces.
- **Before going live:** add a Content-Security-Policy suited to your hosting, run a penetration test, review retention and legal-hold rules, and configure log shipping and alerting.

### Backup & restore

`npm run db:backup` writes a consistent JSON snapshot of every table (git-ignored `backups/`); `scripts/db/restore.mjs` restores it into an empty database at the same migration level. With PostgreSQL client tools:

```bash
pg_dump --format=custom --file=hms-$(date +%F).dump "$DATABASE_URL"    # backup
pg_restore --clean --if-exists --dbname="$DATABASE_URL" hms-YYYY-MM-DD.dump   # restore (into a maintenance window)
```

Also back up the file-storage directory. Test restores regularly, and encrypt backups at rest.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DATABASE_URL is not set` | Create `.env` from `.env.example`. |
| `P1001: Can't reach database server` | Check PostgreSQL is running and the host/port/credentials in `DATABASE_URL`. |
| `npm install` fails downloading Prisma engines | Corporate proxy/firewall: allow `binaries.prisma.sh`, or set `HTTPS_PROXY`. |
| Times appear shifted by hours | Use the provided `lib/db/prisma.js` (it pins the DB session to UTC) and set the hospital time zone in Settings. |
| "Your account does not currently have access to any active hospital" | The user has no active membership, or the hospital was deactivated by a Platform Administrator. |
| Server refuses to start: "AUTH_SECRET must be a random value…" | Set a real `AUTH_SECRET` (≥ 32 random characters) in production. |
| Login says "Too many requests" | Rate limit hit (per IP and per email, 15-minute window). Wait, or clear `RateLimitBucket` rows in development. |
| Account locked | Wait 15 minutes or use *Forgot password*. Admins can reset passwords in Settings → Users. |
| Password reset email "not received" in dev | With `EMAIL_PROVIDER=log` the email is in `storage/mail-log/`. |
| Uploaded file rejected | Only PDF/PNG/JPEG up to `FILE_MAX_BYTES` (default 10 MB) are accepted, checked by content. |
| `DeprecationWarning: Calling client.query() when the client is already executing a query` | Comes from inside Prisma's pg adapter; harmless on `pg@8` (the version range used). |
