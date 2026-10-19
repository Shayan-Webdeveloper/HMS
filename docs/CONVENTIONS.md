# Engineering conventions

These rules keep every module consistent. Read the reference implementation before writing a module:
**Patients** — `lib/services/patients.js`, `lib/validation/patients.js`, `app/api/patients/**`, `app/(app)/patients/**`, `components/patients/**`.

## Stack facts (do not deviate)

- Next.js **16** App Router, React 19, **JavaScript only** (`.js` / `.jsx`, never TypeScript). Package is `"type": "module"`.
- `params` and `searchParams` are **Promises** in pages, layouts and route handlers: `const { id } = await params;`.
- `cookies()` / `headers()` are async. Middleware is `proxy.js` (already done).
- Tailwind CSS v4 (CSS-first, tokens in `styles/globals.css`). Use the component classes there (`btn`, `card`, `input`, `badge`, `table`, …) and tokens (`text-muted`, `bg-primary-soft`, `text-danger`, `border-border`, …).
- Prisma 7 with the `pg` driver adapter. Import the client with `import { prisma } from "@/lib/db/prisma";` (server only).
- Zod v4: `z.email()`, `{ error: "..." }`. React Hook Form + `@hookform/resolvers/zod`.
- Icons: `lucide-react` named imports only. Toasts: `sonner` (`toast.success`). Charts: `recharts` (client components).

## Layers

| Layer | Location | Rules |
|---|---|---|
| Validation | `lib/validation/<module>.js` | Zod schemas shared by client forms and API. No `server-only` import. |
| Business logic | `lib/services/<module>.js` | `import "server-only"`. All DB writes, transactions, state-transition checks, audit calls, notifications. |
| API | `app/api/<module>/**/route.js` | Thin: wrap with `route({ permission }, async ({ body, query, params, session, ip }) => ...)` from `@/lib/api/handler`. Return plain data (auto-wrapped as `{ ok:true, data }`) or `ok(data, meta)`. |
| Pages | `app/(app)/<module>/**/page.js` | Server components. First line: `const session = await requirePageSession("<perm>")`. Query via services/prisma, render with shared UI. |
| Interactive UI | `components/<module>/*.jsx` | `"use client"`. Mutations via `mutate(url, body, { success, form })` or `api()` from `@/components/ui/api-client`, then `router.refresh()`. |

## Security rules (non-negotiable)

1. Every route handler declares a `permission` (see `lib/permissions/matrix.js` for the catalogue). Never rely on hidden buttons.
2. Clinical data (encounters, notes, diagnoses, vitals, lab results, imaging reports) requires `clinical:read` or the module's own read permission.
3. Ownership/IDOR: put the owner constraint in the `where` clause (e.g. `{ id, patientId: session.patientId }`) and return 404 (not 403) when it does not match.
4. Doctors can only finalize/amend encounters where `encounter.doctorId === session.doctorId` (SUPER_ADMIN excepted).
5. Use `prisma.$transaction(async (tx) => ...)` for anything touching more than one row that must stay consistent. Pass `tx` to `audit(..., tx)` and `newId(tx, kind)`.
6. Never hard-delete clinical or financial rows. Use status transitions, `isActive=false`, amendments, reversals.
7. Audit sensitive actions with `audit({ userId, action: "module.verb", entityType, entityId, metadata, ipAddress })`. Metadata = ids/field names/reasons, **never clinical free text**.
8. Notifications (`notifyPermission([...perms], { category, title, body, link })`) must not contain diagnoses or results — just "New lab results released" + link.
9. No PHI in `localStorage`, URLs (except opaque ids), logs, or email subjects.

## Data & identifiers

- Human-readable numbers come from `newId(tx, "<kind>")` in `lib/ids.js` (kinds: patient, employee, appointment, encounter, admission, invoice, receipt, prescription, labOrder, specimen, imaging, emergency, procedure, claim, purchaseOrder).
- Money: never JS floats. Use `D()`, `calcLine`, `calcInvoiceTotals`, `toMoneyString` from `lib/utils/money.js`; display with `formatMoney(v, hospital.currency)`.
- Time: store UTC. Use `lib/utils/time.js` (`zonedToUtc`, `dayRangeUtc`, `todayInTz`, `formatDateTime(d, tz)`, `formatDateOnly` for `@db.Date` columns). Get tz with `const h = await getHospital(); h.timezone`.
- Pass data from server to client components through `serialize()` (`lib/utils/serialize.js`) — Decimals and Dates are not serialisable as-is.
- Stock: every quantity change writes a `StockMovement` row (signed quantity + `balanceAfter`) in the same transaction. DB CHECK constraints forbid negative stock — use conditional `updateMany({ where: { id, quantity: { gte: n } }, data: { quantity: { decrement: n } } })` and treat `count === 0` as "insufficient stock".
- Status transitions: define an `ALLOWED` map in the service and throw `invalidState()` for anything else. Use conditional `updateMany({ where: { id, status: from } })` to be race-safe.

## UI kit (`components/ui`)

`Button` (variant primary|secondary|ghost|danger|success, size sm|md|lg, `icon`, `loading`, `href`), `Card`, `PageHeader`, `Badge` / `StatusBadge`, `DataTable` + `Pagination` (server, URL-driven sorting/paging), `FilterBar` (client, URL-synced search/filters/date range/export), `Modal`, `ConfirmDialog` (with `requireReason`), `FormField` / `TextField` / `SelectField` / `TextareaField` / `CheckboxField` / `FormSection`, `LinkTabs`, `EmptyState` / `ErrorState` / `ForbiddenState` / `Skeleton` / `TableSkeleton`, `MetricCard`, `EntityPicker` / `PatientSelector` / `DoctorSelector`, `api` / `mutate` / `handleFormError`. Shared: `components/shared/FileUploader.jsx`.

Every form: Zod validation, `loading` on submit, toast on success, server field errors mapped with `mutate(..., { form })`. Every list: search + filters + pagination + empty state. Destructive/irreversible actions: `ConfirmDialog`.

## Cross-module API contracts

Modules call each other through these endpoints (JSON envelope `{ ok, data, meta? }`):

| Endpoint | Owner | Contract |
|---|---|---|
| `GET /api/patients?q=&pageSize=` | patients | `[{ id, mrn, firstName, lastName, phone, dateOfBirth, sex }]` |
| `GET /api/doctors?q=&departmentId=&pageSize=` | staff | `[{ id (DoctorProfile.id), name, specialty, departmentId, departmentName, consultationFee, slotMinutes }]` |
| `GET /api/departments` | staff | `[{ id, name, code, isClinical }]` |
| `GET /api/appointments/slots?doctorId=&date=YYYY-MM-DD` | appointments | `{ slots: [{ start: "HH:MM", startsAt: ISO, available: bool }] }` |
| `POST /api/prescriptions` | consultations | `{ patientId, encounterId?, items:[{ medicationId, dose, route, frequency, durationDays, quantity, instructions? }], notes?, finalize: bool }` |
| `GET /api/pharmacy/medications?q=` | pharmacy | `[{ id, code, genericName, brandName, strength, dosageForm, sellingPrice, onHand }]` |
| `POST /api/lab/orders` | laboratory | `{ patientId, encounterId?, testIds:[], priority: ROUTINE|URGENT|STAT, clinicalNotes? }` (permission `lab:order`; doctor = `session.doctorId`) |
| `GET /api/lab/tests?q=` | laboratory | `[{ id, code, name, category, price, specimenType }]` |
| `POST /api/radiology/studies` | radiology | `{ patientId, encounterId?, catalogCode, indication? }` (permission `radiology:order`) |
| `GET /api/radiology/catalog` | radiology | `[{ code, modality, bodyPart, price }]` (from SystemSetting `imaging.catalog`) |

Billing discovers unbilled charges by looking for source rows (`Encounter` finalized, `LabOrderItem`, `ImagingStudy`, `PrescriptionItem` dispensed quantities via `StockMovement` type `DISPENSE`, bed days from `BedAssignment`, `Procedure`) that have no `InvoiceItem` with matching `sourceType` + `sourceId`.

## Page map

`/dashboard /notifications /patients /appointments /consultations /emergency /admissions /wards /procedures /laboratory /radiology /pharmacy /inventory /billing /insurance /doctors /staff /departments /ambulances /reports /settings /audit-logs /portal/*`

## Verification

- Lint: `npx eslint <your paths>`.
- Build in an isolated output folder so parallel work doesn't collide: `NEXT_DIST_DIR=.next-<name> npx next build`.
- Unit tests for pure logic go in `tests/unit/<module>.test.js` (`npx vitest run tests/unit/<module>.test.js`).
- Dev DB has seeded demo data; demo password is `DemoPass2026` (dev only). Do not re-run the seed — other work shares the database.
