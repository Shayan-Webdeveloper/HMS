# Implementation status

Legend: ✅ implemented and verified (automated tests and/or scripted HTTP checks) · 🟡 implemented with a documented limitation · ⬜ not implemented

Verification at delivery: `npm run lint` clean · `npm run build` succeeds (271 routes) · `npm run test` 222/222 · `npm run test:e2e` 33/33 against a seeded server · key screens visually reviewed in headless Chromium at desktop and phone widths.

**Latest verification — 2026-11-19 (security hardening, commit on branch `security/final-hardening`), all re-run, nothing copied from earlier commits:**

| Command | Result | Notes |
|---|---|---|
| `npm run lint` | ✅ clean | |
| `npm test` | ✅ 244 passed, 0 failed, 0 skipped | 14 files |
| `npm run test:db` | ✅ 26 passed, 0 failed, 0 skipped | throwaway embedded PostgreSQL 17 with Supabase-like roles; all 8 migrations applied |
| `NEXT_DIST_DIR=.next-build npx next build` | ✅ succeeds | Next.js 16.4.6, against a throwaway database |
| `npm run test:e2e` | ✅ 65 passed (33 workflow + 32 multi-hospital), 0 failed, 0 skipped | **HTTP-level** tests against the built server on a throwaway seeded database (file storage and email forced to local/log) — not browser-driven |
| Password reset (scripted HTTP, throwaway DB) | ✅ | token created; unknown email gets the same answer; reset → sign-in with the new password; token single-use; logout revokes the session |
| Migration rehearsal (`scripts/db/verify-migrations.mjs` on a fresh backup of the live database) | ✅ | rows kept, hospital ownership intact, RLS policies present, `anon`/`authenticated` without privileges, no schema drift |
| Live database (read-only checks after applying the migration) | ✅ | see docs/SECURITY.md §3; hospital isolation checked as `hms_app` (the live database has one hospital — two-hospital isolation is covered by `test:db` and the e2e suite) |
| Smoke test, new code against the live database (local server, HTTP) | ✅ | Super Admin / Receptionist / Doctor / Patient / Platform Admin: sign-in, session roles, patient API allowed only for staff, platform API only for the Platform Administrator, notifications, logout |
| Supabase Security Advisor | ✅ 0 errors, 0 warnings, 3 info | info = intentional deny-all tables (`PasswordResetToken`, `RateLimitBucket`, `_prisma_migrations`) |
| Supabase Performance / Health Advisor | ✅ 0 errors, 0 warnings | Performance: 113 info, all "unused index" on a low-traffic database (expected); Health: none |
| Supabase Data API | ✅ disabled | no exposed schemas; the app does not use it |

## Foundation
| Feature | Status | Notes |
|---|---|---|
| PostgreSQL schema (67 tables), migrations, CHECK constraints | ✅ | `prisma/schema.prisma`, `prisma/migrations/*` |
| Seed with synthetic data (32+ patients, 130 appointments, encounters, labs, stock, invoices, admissions, ER, OT, insurance, HR) | ✅ | Dev-only, refuses production |
| Auth: login, logout, sessions, idle/absolute expiry, lockout, rate limits | ✅ | |
| Forgot / reset password, change password, forced change of temporary passwords | ✅ | |
| RBAC: 11 roles × 66 permissions, server-enforced, editable matrix | ✅ | |
| Audit log (auth, views, exports, clinical & financial changes) | ✅ | |
| App shell: collapsible sidebar, breadcrumbs, Ctrl-K global search, notifications, user menu, mobile nav | ✅ | |
| Design system: tokens, buttons, forms, tables, badges, modals, tabs, skeletons, empty/error states, toasts | ✅ | |
| Private document upload/download with content sniffing | ✅ | Category-based permissions; local or private Supabase Storage provider |

## Clinical
| Feature | Status | Notes |
|---|---|---|
| Patient registration, duplicate warning, search/filter/sort/paging, CSV export | ✅ | |
| Patient profile (13 tabs + timeline), archive/restore, controlled merge | ✅ | |
| Allergies & medical history | ✅ | |
| Doctor directory, profiles, weekly availability, schedule exceptions | ✅ | |
| Appointment booking with slot calculation and concurrency-safe conflict prevention | ✅ | Advisory locks; race-tested |
| Calendar day / week / month, filters | ✅ | |
| Confirm / check-in (queue tokens) / start / complete / no-show / cancel / reschedule | ✅ | Explicit state machine |
| Walk-ins | 🟡 | Bypass clinic-hour windows by design; still check doctor leave and patient double-booking |
| Appointment confirmation emails | 🟡 | Only to consenting patients; real delivery needs SMTP configured |
| OPD queue, vitals, SOAP documentation, diagnoses | ✅ | |
| Finalize (own doctor only), read-only after finalize, amendments with reason | ✅ | |
| Prescriptions with basic allergy name-match warning | 🟡 | Clearly labelled; **not** a drug-interaction / CDS system |
| Lab & imaging ordering from the encounter | ✅ | |
| Printable visit summary and prescription | ✅ | |
| Discard a draft encounter | ⬜ | |
| Admissions with atomic bed claim, transfer, discharge, summaries | ✅ | Race-tested |
| Bed board, ward/bed management, cleaning/out-of-service | 🟡 | Out-of-service reason kept in the audit log (no column) |
| Inpatient vitals (chart), progress/round/nursing notes, medication administration record | ✅ | |
| Emergency: registration (incl. quick-register), manual triage, clinician assignment, dispositions, activity log | 🟡 | Transfer destination stored in the disposition text |
| Ambulance fleet & dispatch lifecycle | 🟡 | Live GPS not included (needs a location provider) |
| Operating theatre scheduling with theatre/surgeon conflict checks, pre-op checklist, op notes | 🟡 | Cancel reason and actual start/end times kept in the audit log |
| Immunization records | 🟡 | Captured as medical-history category `IMMUNIZATION`, no dedicated schedule |
| Referrals | 🟡 | Uploaded as documents (category REFERRAL); no structured referral workflow |

## Diagnostics
| Feature | Status | Notes |
|---|---|---|
| Lab orders, worklist, specimen collection/rejection/recollection, processing | ✅ | |
| Result entry with flagging against configured ranges only | ✅ | |
| Validation & release, optional second-person rule, corrections preserving history | ✅ | |
| Printable lab report, test catalogue management | ✅ | |
| Radiology requests, scheduling, reporting, verification, attachments, catalogue | 🟡 | Attachments are not a PACS/DICOM viewer; a verified report cannot be amended |

## Pharmacy, inventory, finance
| Feature | Status | Notes |
|---|---|---|
| Medication catalogue, batches, receiving, adjustments, write-offs, ledger, CSV | ✅ | |
| Dispensing with FEFO allocation, no expired stock, no over-dispensing, returns | ✅ | Race-tested |
| Low-stock and expiry alerts | ✅ | |
| General inventory, issues to departments, valuation, suppliers, purchase orders | 🟡 | Supplier payables not tracked (no supplier-payment table) |
| Invoices from unbilled charges (consultation, lab, imaging, pharmacy, bed days, procedures) + manual items | ✅ | Double-billing prevented |
| Discounts (with reason), tax, issue, partial payments, idempotent payments, refunds, void | ✅ | Exact decimal arithmetic |
| Printable invoice and receipt, generated PDF invoice | ✅ | |
| Online card payments | ⬜ | No payment provider integrated (CARD = recorded terminal payment) |
| Insurance providers, policies, claims, settlement reconciliation | 🟡 | Manual tracking; no insurer integration |
| HR: staff records, employment status (with immediate account revocation), attendance, leave | ✅ | |
| Payroll | ⬜ | Not included |

## Insights & portal
| Feature | Status | Notes |
|---|---|---|
| Role dashboards from live data with date ranges and previous-period trends | ✅ | |
| 19 reports with filters, charts, print, formula-safe CSV export | 🟡 | Pharmacy sales use current selling price (price at dispense not stored) |
| Notifications centre | ✅ | In-app; email only where noted |
| Audit log viewer with export | ✅ | |
| Settings: hospital, locale, appointment policy, billing, pharmacy, lab, triage categories, users, roles | 🟡 | Identifier prefixes are code constants (`lib/ids.js`), shown read-only |
| Patient portal: dashboard, appointments (request/cancel), prescriptions, results, invoices, documents, profile | ✅ | Requests are confirmed by staff (placeholder time until confirmed) |

## Cross-cutting
| Item | Status | Notes |
|---|---|---|
| Responsive layouts (desktop, tablet, phone) | ✅ | Tables collapse to cards on phones |
| Accessibility (labels, focus rings, keyboard dialogs, ARIA, reduced motion) | 🟡 | Built to WCAG 2.2 AA practices; no formal audit performed |
| Multi-hospital (tenancy) | ✅ | Hospital-scoped data in 61 tables, isolation in app + PostgreSQL RLS, per-hospital roles, hospital switcher, Platform Administrator console. See docs/MULTI_TENANCY.md |
| Multi-facility within a hospital | 🟡 | `Facility` exists per hospital (wards belong to a facility); no per-facility access rules |
| Unit tests | ✅ | 244 (verified 2026-11-19) |
| Database isolation tests (embedded PostgreSQL) | ✅ | 26 (verified 2026-11-19) |
| End-to-end tests | 🟡 | HTTP-level (33 workflow + 32 multi-hospital isolation) rather than browser-driven |
| Redirect status codes | 🟡 | Because of the route-level loading UI, page redirects/404s stream as HTTP 200 and resolve client-side (no protected content is rendered) |
| Regulatory certification (HIPAA / GDPR / local law) | ⬜ | Requires independent review |
