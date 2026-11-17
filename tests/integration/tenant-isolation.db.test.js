// Database-level multi-hospital isolation tests.
//
// Runs the real migrations against a disposable embedded PostgreSQL 17 that emulates Supabase roles
// (tests/support/embedded-db.mjs), connects as the same kind of owner role the app uses, and proves
// that isolation holds in the DATABASE — not only in application code:
//   npm run test:db
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import pg from "pg";
import { startTestDatabase } from "../support/embedded-db.mjs";
import { createPrismaClient } from "../../lib/db/client-factory.js";
import { createTenantClient, runWithTenant, TenantContextError } from "../../lib/db/tenant-client.js";
import { tenantModels } from "../../lib/db/tenancy-model.js";
import { provisionHospital, grantMembership } from "../../lib/tenancy/provision.js";
import { nextIdentifier } from "../../lib/utils/sequence.js";

let db, base, prisma, owner;
const A = {}, B = {};

async function seedHospital(h, label) {
  const hospital = await provisionHospital(base, { name: `${label} Hospital`, code: label });
  h.id = hospital.id;
  h.user = await base.user.create({ data: { email: `admin@${label.toLowerCase()}.test`, name: `${label} Admin`, passwordHash: "x" } });
  await grantMembership(base, { hospitalId: h.id, userId: h.user.id, roleKeys: ["SUPER_ADMIN"] });
  await runWithTenant({ hospitalId: h.id }, async () => {
    const dept = await prisma.department.create({ data: { code: "GM", name: "General Medicine" } });
    const staff = await prisma.staff.create({ data: { employeeNo: "EMP-0001", firstName: "Doc", lastName: label, position: "Doctor", joiningDate: new Date("2024-01-01"), departmentId: dept.id, userId: h.user.id } });
    h.doctor = await prisma.doctorProfile.create({ data: { staffId: staff.id, departmentId: dept.id, specialty: "GP", licenseNumber: "LIC-1", consultationFee: "1000.00" } });
    h.dept = dept;
    h.patient = await prisma.patient.create({ data: { mrn: await nextIdentifier(prisma, "patient", "MRN", 6), firstName: "Pat", lastName: label } });
    h.invoice = await prisma.invoice.create({ data: { invoiceNo: `INV-${label}`, patientId: h.patient.id, createdById: h.user.id } });
    h.doc = await prisma.uploadedDocument.create({ data: { patientId: h.patient.id, ownerType: "PATIENT", ownerId: h.patient.id, category: "LAB_REPORT", originalName: "r.pdf", storageKey: `${h.id}/2026-11/x-${label}.pdf`, mimeType: "application/pdf", sizeBytes: 10, sha256: "0", uploadedById: h.user.id } });
  });
}

/** Run SQL on one owner connection inside a transaction that carries `hospitalId` as hms_app. */
async function asApp(hospitalId, sql, params = []) {
  await owner.query("BEGIN");
  try {
    if (hospitalId !== undefined) await owner.query("SELECT set_config('role','hms_app',true), set_config('app.hospital_id',$1,true)", [hospitalId ?? ""]);
    const r = await owner.query(sql, params);
    await owner.query("COMMIT");
    return r;
  } catch (e) {
    await owner.query("ROLLBACK");
    throw e;
  }
}

beforeAll(async () => {
  db = await startTestDatabase({ port: 54335, dir: ".tmp/pg-itest" });
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: db.url }, stdio: "pipe" });
  base = createPrismaClient(db.url);
  prisma = createTenantClient(base);
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await seedHospital(A, "AAA");
  await seedHospital(B, "BBB");
}, 240000);

afterAll(async () => {
  await owner?.end();
  await base?.$disconnect();
  await db?.stop();
});

describe("database role and RLS (hms_app)", () => {
  it("hospital A's context cannot read hospital B's rows", async () => {
    const r = await asApp(A.id, `SELECT "hospitalId" FROM "Patient"`);
    expect(r.rows.length).toBe(1);
    expect(r.rows.every((x) => x.hospitalId === A.id)).toBe(true);
    for (const table of ["Invoice", "UploadedDocument", "DoctorProfile", "Staff", "AuditLog", "RolePermission", "UserRole", "HospitalMembership", "SystemSetting"]) {
      const rows = (await asApp(A.id, `SELECT "hospitalId" FROM "${table}"`)).rows;
      expect(rows.some((x) => x.hospitalId === B.id), table).toBe(false);
    }
  });

  it("raw SQL with an explicit filter for B returns nothing in A's context", async () => {
    const r = await asApp(A.id, `SELECT id FROM "Patient" WHERE "hospitalId" = $1`, [B.id]);
    expect(r.rows).toEqual([]);
  });

  it("cannot insert, update or delete hospital B's rows from A's context", async () => {
    await expect(asApp(A.id, `INSERT INTO "Patient" (id, "hospitalId", mrn, "firstName", "lastName", "updatedAt") VALUES ('x1', $1, 'MRN-X', 'a', 'b', now())`, [B.id])).rejects.toThrow(/row-level security/);
    const upd = await asApp(A.id, `UPDATE "Patient" SET "firstName" = 'hacked' WHERE id = $1`, [B.patient.id]);
    expect(upd.rowCount).toBe(0);
    const del = await asApp(A.id, `DELETE FROM "UploadedDocument" WHERE id = $1`, [B.doc.id]);
    expect(del.rowCount).toBe(0);
    const still = await base.patient.findUnique({ where: { id: B.patient.id } });
    expect(still.firstName).toBe("Pat");
  });

  it("without a hospital context hms_app sees nothing and cannot insert", async () => {
    const r = await asApp(null, `SELECT count(*)::int AS n FROM "Patient"`);
    expect(r.rows[0].n).toBe(0);
    await expect(asApp(null, `INSERT INTO "Ambulance" (id, "vehicleNo", type) VALUES ('amb1', 'V-1', 'BLS')`)).rejects.toThrow();
  });

  it("the hospital context ends with the transaction (no leak on a reused connection)", async () => {
    await asApp(A.id, "SELECT 1");
    const r = await owner.query(`SELECT current_user AS u, coalesce(current_setting('app.hospital_id', true), '') AS h`);
    expect(r.rows[0].u).not.toBe("hms_app");
    expect(r.rows[0].h).toBe("");
  });

  it("audit logs are append-only for the application role", async () => {
    await asApp(A.id, `INSERT INTO "AuditLog" (id, action, "entityType") VALUES ('al-1', 'test.event', 'Test')`);
    await expect(asApp(A.id, `UPDATE "AuditLog" SET action = 'x' WHERE id = 'al-1'`)).rejects.toThrow(/permission denied/);
    await expect(asApp(A.id, `DELETE FROM "AuditLog" WHERE id = 'al-1'`)).rejects.toThrow(/permission denied/);
  });

  it("users of another hospital and platform accounts are invisible; members are visible", async () => {
    const platform = await base.user.create({ data: { email: "plat@test", name: "P", passwordHash: "x", platformRole: "PLATFORM_ADMIN" } });
    const r = await asApp(A.id, `SELECT id FROM "User"`);
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(A.user.id);
    expect(ids).not.toContain(B.user.id);
    expect(ids).not.toContain(platform.id);
    await expect(asApp(A.id, `UPDATE "User" SET name = 'x' WHERE id = $1`, [B.user.id])).resolves.toMatchObject({ rowCount: 0 });
  });

  it("a hospital context cannot create Platform Administrators", async () => {
    await expect(asApp(A.id, `INSERT INTO "User" (id, email, name, "passwordHash", "platformRole", "updatedAt") VALUES ('u-esc', 'esc@test', 'x', 'x', 'PLATFORM_ADMIN', now())`)).rejects.toThrow(/row-level security/);
  });

  it("only the own hospital row is visible in Hospital", async () => {
    const r = await asApp(A.id, `SELECT id FROM "Hospital"`);
    expect(r.rows.map((x) => x.id)).toEqual([A.id]);
  });
});

describe("cross-hospital reference guards (triggers)", () => {
  it("rejects a hospital A row that references hospital B's patient — even for the owner role", async () => {
    await expect(owner.query(
      `INSERT INTO "Invoice" (id, "hospitalId", "invoiceNo", "patientId", "updatedAt") VALUES ('inv-x', $1, 'INV-X', $2, now())`, [A.id, B.patient.id],
    )).rejects.toThrow(/HMS_TENANT_VIOLATION/);
  });

  it("rejects moving a row to another hospital", async () => {
    await expect(owner.query(`UPDATE "Patient" SET "hospitalId" = $1 WHERE id = $2`, [B.id, A.patient.id])).rejects.toThrow(/HMS_TENANT_VIOLATION/);
  });

  it("every hospital-owned table has RLS, a tenant policy and a guard trigger", async () => {
    const models = tenantModels();
    const pol = (await owner.query(`SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname='hms_tenant_isolation'`)).rows.map((r) => r.tablename);
    const trg = (await owner.query(`SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='hms_same_hospital'`)).rows.map((r) => r.relname);
    const rls = (await owner.query(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity`)).rows.map((r) => r.relname);
    for (const m of models) {
      expect(pol, `policy on ${m}`).toContain(m);
      expect(trg, `trigger on ${m}`).toContain(m);
      expect(rls, `RLS on ${m}`).toContain(m);
    }
  });
});

describe("Supabase API roles", () => {
  it("anon and authenticated hold no privileges on application tables", async () => {
    const r = await owner.query(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated')`);
    expect(r.rows[0].n).toBe(0);
    for (const role of ["anon", "authenticated"]) {
      await owner.query("BEGIN");
      await owner.query(`SET LOCAL ROLE ${role}`);
      await expect(owner.query(`SELECT 1 FROM "Patient" LIMIT 1`)).rejects.toThrow(/permission denied/);
      await owner.query("ROLLBACK");
    }
  });

  it("rls_auto_enable still enables RLS on new tables after its public EXECUTE grant was revoked", async () => {
    const acl = (await owner.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname='rls_auto_enable'`)).rows[0].acl;
    expect(acl).not.toMatch(/(^|[{,])=X/); // PUBLIC
    expect(acl).not.toMatch(/anon=X|authenticated=X/);
    await owner.query(`CREATE TABLE public.tmp_rls_probe (id int)`);
    const r = await owner.query(`SELECT relrowsecurity FROM pg_class WHERE relname='tmp_rls_probe'`);
    expect(r.rows[0].relrowsecurity).toBe(true);
    await owner.query(`DROP TABLE public.tmp_rls_probe`);
  });
});

describe("hospital-scoped Prisma client", () => {
  it("fails closed without a hospital context", async () => {
    await expect(prisma.patient.findMany()).rejects.toBeInstanceOf(TenantContextError);
  });

  it("lists only the current hospital's records", async () => {
    const rows = await runWithTenant({ hospitalId: A.id }, () => prisma.patient.findMany());
    expect(rows.map((p) => p.id)).toEqual([A.patient.id]);
  });

  it("returns null for another hospital's record id (no IDOR)", async () => {
    const p = await runWithTenant({ hospitalId: A.id }, () => prisma.patient.findUnique({ where: { id: B.patient.id } }));
    expect(p).toBeNull();
    const d = await runWithTenant({ hospitalId: A.id }, () => prisma.uploadedDocument.findUnique({ where: { id: B.doc.id } }));
    expect(d).toBeNull();
  });

  it("cannot update or delete another hospital's record", async () => {
    await expect(runWithTenant({ hospitalId: A.id }, () => prisma.patient.update({ where: { id: B.patient.id }, data: { firstName: "x" } }))).rejects.toMatchObject({ code: "P2025" });
    const r = await runWithTenant({ hospitalId: A.id }, () => prisma.invoice.deleteMany({ where: { id: B.invoice.id } }));
    expect(r.count).toBe(0);
  });

  it("refuses an explicit foreign hospitalId in queries and writes", async () => {
    await expect(runWithTenant({ hospitalId: A.id }, () => prisma.patient.findMany({ where: { hospitalId: B.id } }))).rejects.toBeInstanceOf(TenantContextError);
    await expect(runWithTenant({ hospitalId: A.id }, () => prisma.ambulance.create({ data: { hospitalId: B.id, vehicleNo: "X", type: "BLS" } }))).rejects.toBeInstanceOf(TenantContextError);
  });

  it("raw SQL through the client is limited by RLS", async () => {
    const rows = await runWithTenant({ hospitalId: A.id }, () => prisma.$queryRaw`SELECT id FROM "Patient"`);
    expect(rows.map((r) => r.id)).toEqual([A.patient.id]);
  });

  it("interactive transactions keep the context for every query, including the global client inside", async () => {
    const ids = await runWithTenant({ hospitalId: B.id }, () => prisma.$transaction(async (tx) => {
      const a = await tx.patient.findMany({ select: { id: true } });
      const b = await prisma.patient.findMany({ select: { id: true } });
      const raw = await tx.$queryRaw`SELECT current_setting('app.hospital_id', true) AS h`;
      return { a, b, h: raw[0].h };
    }));
    expect(ids.a.map((x) => x.id)).toEqual([B.patient.id]);
    expect(ids.b.map((x) => x.id)).toEqual([B.patient.id]);
    expect(ids.h).toBe(B.id);
  });

  it("identifier sequences are independent per hospital", async () => {
    expect(A.patient.mrn).toBe("MRN-000001");
    expect(B.patient.mrn).toBe("MRN-000001");
  });

  it("concurrent requests for different hospitals never see each other's data", async () => {
    const runs = await Promise.all(Array.from({ length: 20 }, (_, i) => {
      const h = i % 2 ? A : B;
      return runWithTenant({ hospitalId: h.id }, async () => ({ want: h.patient.id, got: (await prisma.patient.findMany({ select: { id: true } })).map((p) => p.id) }));
    }));
    for (const r of runs) expect(r.got).toEqual([r.want]);
  });
});
