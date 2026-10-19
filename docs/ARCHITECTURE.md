# Architecture

## Shape

One Next.js 16 application (no microservices) with four layers:

```
Browser ──► proxy.js (optimistic cookie check only)
        ──► app/(app)/**/page.js      Server Components: requirePageSession(perm) → services/prisma → render
        ──► app/api/**/route.js       route({ permission }) wrapper: session, RBAC, CSRF origin check, Zod, error mapping
                    │
                    ▼
            lib/services/*.js         business rules, state machines, transactions, audit, notifications
                    │
                    ▼
            Prisma 7 (pg adapter) ──► PostgreSQL (constraints, CHECKs, sequences, advisory locks)
```

Client components (`components/**`) only do interaction. They call the JSON API (`{ ok, data, meta }` / `{ ok:false, error:{ code, message, fields } }`) and then `router.refresh()`. Lists are server-rendered, with search, sort and paging stored in the URL, so they are shareable and work without client state.

## Key decisions

| Decision | Why |
|---|---|
| **Own session layer instead of Auth.js** | Auth.js v5 (the line for current Next.js) is still beta. DB sessions give instant revocation (deactivate user → access ends on their next request), which matters for hospital staff turnover. The code is small and auditable (`lib/auth`). |
| **Prisma 7 + driver adapter, session pinned to UTC** | The pg driver sends timestamps without an offset; on a server whose default zone is local, instants would shift. `options: "-c TimeZone=UTC"` fixes this at the connection. All display conversion uses the hospital time zone setting. |
| **Atomic identifiers via `Sequence` table** | `INSERT … ON CONFLICT DO UPDATE … RETURNING` gives gap-tolerant, collision-free MRNs, invoice numbers and similar under concurrency. |
| **Concurrency control** | Appointments and theatres: `pg_advisory_xact_lock` per doctor/theatre, then re-check overlap. Beds: conditional `updateMany` (status=AVAILABLE) plus a unique `Bed.currentAdmissionId` and a CHECK constraint. Stock: conditional decrements plus CHECK `quantity >= 0`. Payments: `SELECT … FOR UPDATE` plus a unique idempotency key. |
| **Append-only clinical & financial history** | Finalized encounters → amendments; lab corrections → new current row; invoices → void/refund; stock → signed ledger with running balance. |
| **Permissions in DB, defaults in code** | `lib/permissions/matrix.js` seeds defaults; runtime reads `RolePermission`, so the matrix can be edited in Settings without a deploy. |
| **No clinical inference** | Lab flags compare against configured ranges only. Triage is chosen by staff. Allergy warnings are labelled as name matching. No diagnosis or treatment suggestions anywhere. |
| **Documents as print pages + PDFKit for invoices** | Print CSS covers every document with zero dependencies; a generated PDF is provided where it's most often needed (invoices). |
| **Local private storage behind an interface** | `lib/storage` keeps files outside the web root; swap the provider for S3/Blob without touching callers. |

## Data model map

- **Identity:** User, Session, PasswordResetToken, Role, Permission, RolePermission, UserRole, RateLimitBucket
- **Organisation:** Hospital, Facility, Department, SystemSetting, Staff, DoctorProfile, DoctorAvailability, ScheduleException, EmployeeAttendance, LeaveRequest
- **Patient:** Patient, PatientUserLink, EmergencyContact, Allergy, MedicalHistory, UploadedDocument
- **Outpatient:** Appointment, QueueEntry, Encounter, ClinicalNote, Diagnosis, VitalSign, Prescription, PrescriptionItem
- **Inpatient & ER:** Ward, Bed, Admission, BedAssignment, MedicationAdministration, EmergencyVisit, Ambulance, AmbulanceDispatch, OperatingTheatre, Procedure
- **Diagnostics:** LaboratoryTest, LabOrder, LabOrderItem, Specimen, LabResult, ImagingStudy, ImagingReport
- **Supply:** Medication, MedicationBatch, InventoryItem, Supplier, PurchaseOrder, PurchaseOrderItem, StockMovement
- **Finance:** Invoice, InvoiceItem, Payment, Refund, InsuranceProvider, InsurancePolicy, InsuranceClaim
- **Cross-cutting:** Notification, AuditLog, Sequence

Billing finds unbilled work by matching `InvoiceItem.sourceType + sourceId` against source rows (finalized encounters, lab items, imaging studies, dispensed prescription items via the stock ledger, bed assignments, completed procedures). Modules therefore stay decoupled, and double-billing is prevented.

## Known upstream notes

- Prisma's pg adapter emits a `pg` deprecation warning about overlapping queries inside transactions. It is harmless on `pg@8`; re-check this when upgrading to `pg@9`.
- The route-level `loading.js` streams pages, so server-side `redirect()`/`notFound()` arrive as HTTP 200 with a client-side redirect. Remove `app/(app)/loading.js` if strict status codes matter more than instant loading skeletons.
