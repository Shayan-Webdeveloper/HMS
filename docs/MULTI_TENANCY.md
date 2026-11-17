# Multi-hospital architecture

Many independent hospitals (e.g. City Hospital, Central Hospital, Al-Shifa Hospital) use one HMS deployment
and one database. Each hospital's data is completely separate. This document explains the model, how
isolation is enforced at every layer, and how existing data was migrated.

## 1. Data model

| Kind | Tables | Rule |
|---|---|---|
| **Hospital-owned** (61 tables) | Patient, Appointment, Encounter, Invoice, LabOrder, Medication, UploadedDocument, AuditLog, Sequence, UserRole, RolePermission, HospitalMembership, … — every model with a `hospitalId` column | Belongs to exactly one hospital. `hospitalId` is `NOT NULL` (AuditLog: NULL = platform event) |
| **Global** | Hospital, User, Session, PasswordResetToken, Role, Permission, RateLimitBucket | No hospital data inside; access rules below |

* The list of hospital-owned models is **derived from the Prisma schema** (`lib/db/tenancy-model.js`: every
  model with a `hospitalId` field). Nothing is maintained by hand.
* `hospitalId` defaults to `hms_internal.current_hospital_id()`, i.e. the transaction-local setting
  `app.hospital_id` that the server sets from the authenticated session. Without it an insert fails
  (`NULL` violates `NOT NULL`), so a row can never be written "for no hospital" or for a hospital taken
  from client input.
* Identifiers are unique **per hospital** (`@@unique([hospitalId, mrn])`, invoice numbers, codes, …) and
  generated from per-hospital sequences, so every hospital has its own `MRN-000001`.
* Every hospital-owned table has an index that starts with `hospitalId` (covering its foreign key and
  the common tenant-scoped list queries).

### Accounts, memberships and roles

* A **User** is one login (email is globally unique) — a doctor working at two hospitals has one account.
* **HospitalMembership** (`hospitalId`, `userId`, `isActive`) grants access to one hospital.
* **UserRole** (`hospitalId`, `userId`, `roleId`) — roles are granted **per hospital**. Being Super
  Administrator in City Hospital gives nothing in Central Hospital.
* **RolePermission** (`hospitalId`, `roleId`, `permissionId`) — each hospital edits its own role matrix;
  edits never affect another hospital. Role names and the permission catalogue are global.
* **Staff** and **PatientUserLink** are per hospital (`@@unique([hospitalId, userId])`).
* A session works in one hospital at a time (`Session.activeHospitalId`). It is chosen only among the
  user's **active memberships of active hospitals** and re-verified on every request. Users with several
  memberships get a hospital switcher in the header (`POST /api/auth/hospital`, which re-checks
  membership and answers 404 otherwise).

### Platform Administrator (above hospitals)

`User.platformRole = PLATFORM_ADMIN` — a separate role, not one of the hospital roles. A Platform
Administrator works in `/platform` and can:

* list hospitals (name, code, status, active member count), create, deactivate and reactivate them;
* appoint a hospital's administrators (new account with a one-time password, or an existing account);
* reset any non-platform account's password (needed for accounts shared by several hospitals);
* read **platform-level** audit events (`AuditLog.hospitalId IS NULL`).

It **cannot** read or change any hospital's patients, clinical, financial, HR or operational records:
platform routes (`route({ platform: true })`) never receive a hospital context, so the hospital-scoped
client fails closed, and the database role used for hospital data (`hms_app`) cannot even see platform
accounts. Hospital administrators never receive platform privileges, and a hospital context cannot
create platform accounts (RLS policy on `User`).

## 2. How isolation is enforced

```
request ─► route()/page ─► session (server-side, cookie → DB)  ─► hospitalId of the session
                             │
                             ▼
             runWithTenant({ hospitalId })   (AsyncLocalStorage, per request)
                             │
                             ▼
             prisma (lib/db/tenant-client.js)
               1. adds  WHERE "hospitalId" = <hospital>  to every read/update/delete of a hospital-owned model
               2. refuses a foreign hospitalId in filters or written data
               3. runs the query in a transaction that first does
                    set_config('role','hms_app',true), set_config('app.hospital_id',<hospital>,true)
                             │
                             ▼
             PostgreSQL as role hms_app (NOBYPASSRLS)
               • RLS policy on all 61 hospital-owned tables: USING/WITH CHECK "hospitalId" = app.hospital_id
               • triggers reject cross-hospital references and moving rows between hospitals
               • audit log is append-only for hms_app
```

| Layer | Mechanism | File |
|---|---|---|
| Pages | `requirePageSession` / `requirePortalSession` / `requirePlatformSession` | `lib/auth/session.js` |
| API | `route()` runs every handler inside the session's hospital context; platform routes have none | `lib/api/handler.js` |
| Queries | Hospital-scoped Prisma client (application filter + DB context) | `lib/db/tenant-client.js`, `lib/db/prisma.js` |
| Database | `hms_app` role, RLS policies, same-hospital triggers (generated from the schema) | `prisma/migrations/20261117000200_tenant_isolation_rls`, `scripts/db/generate-tenant-security-sql.mjs` |
| Files | Storage keys start with the hospital id; reads verify the prefix | `lib/storage/index.js` |
| Documents | Category permissions + same hospital + own patient | `lib/services/documents.js`, `lib/permissions/documents.js` |
| Search / reports / exports / dashboards / notifications / audit | Use the hospital-scoped client ⇒ covered by both layers (raw SQL in reports is covered by RLS) | `lib/services/*` |

**The client never chooses the hospital.** A `hospitalId` in a request body or query string is ignored
or rejected; the only source is the server-side session.

### Pooled connections

The context is set with `set_config(…, true)` — *transaction-local*. It disappears at `COMMIT`/`ROLLBACK`,
so a connection returned to the pool (pg pool, Supabase Supavisor in session or transaction mode) never
carries one request's hospital into another. Each standalone query runs as
`BEGIN; set_config(…); <query>; COMMIT`; interactive transactions set it once. Tested in
`tests/integration/tenant-isolation.db.test.js` (including 20 concurrent mixed-hospital requests).

**Trade-off:** each standalone query costs one extra round trip (the context statement inside a short
transaction). This is the price of database-enforced isolation with Prisma; group related reads in a
`prisma.$transaction(async (tx) => …)` where latency matters.

### What the owner role can still do

The connection role (Supabase `postgres`) has `BYPASSRLS`; it is used **only** by `systemPrisma` for
sign-in/session handling, rate limiting, platform administration and maintenance scripts — all with
explicit filters (grep for `systemPrisma` to review every use). The same-hospital triggers apply even to
this role.

## 3. Existing data migration (`20261117000100_multi_hospital_tenancy`)

1. Columns are added as `NULL`able.
2. Backfill:
   * exactly **one** hospital → every existing hospital-owned row (and its sequences, role grants and audit
     events) is assigned to it, and every user with a role becomes a member of it;
   * **zero** hospitals → allowed only when hospital-owned tables are empty (fresh install);
   * **several** hospitals and existing data → the migration **aborts without changing anything**
     (ownership would be a guess). Assign `hospitalId` manually, then re-run.
3. `NOT NULL` + the session-derived default are applied, then per-hospital unique keys, indexes and FKs.

Rehearsal on a copy of the real data (`npm run db:verify-migrations -- backups/<dir>`): all rows kept, all
61 tables assigned to the existing hospital, memberships created, RLS policies everywhere, no drift
between the database and `schema.prisma`.

### Rollback

Take a backup first (`npm run db:backup`). The supported rollback is restoring that backup into a database
at the previous migration (`scripts/db/restore.mjs`). Reverse DDL is mechanical (drop the added columns,
tables, policies, triggers, role; recreate the old global unique indexes) but is only safe while a single
hospital exists — with several hospitals, identifiers such as `MRN-000001` exist once per hospital and the
old global unique indexes could not be recreated.

## 4. Adding a hospital-owned table

1. Add `hospitalId String @default(dbgenerated("hms_internal.current_hospital_id()"))` and the `hospital`
   relation (plus a `Hospital` back-relation) and an index starting with `hospitalId`.
2. `npx prisma migrate dev` for the DDL.
3. `npm run db:generate-tenant-sql > prisma/migrations/<new>/migration.sql` to (re)apply policies,
   grants and guards. `tests/unit/tenancy.test.js` fails if the latest generated migration is stale, and
   `tests/integration/tenant-isolation.db.test.js` fails if any hospital-owned table lacks RLS, a policy or
   a guard trigger.
