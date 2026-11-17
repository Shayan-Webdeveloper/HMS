import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ROLES, PERMISSIONS, DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_GROUPS, documentPermission } from "@/lib/permissions/matrix";
import { staffCanReadCategory, staffCanUploadCategory, readableCategories, patientCanRead } from "@/lib/permissions/documents";
import { scopeArgs, isTenantModel, TenantContextError, runWithTenant, explicitTenantContext } from "@/lib/db/tenant-client";
import { tenantModels, GLOBAL_MODELS } from "@/lib/db/tenancy-model";
import { generateTenantSecuritySql } from "@/scripts/db/generate-tenant-security-sql.mjs";

const session = (roleKey, extra = {}) => ({ permissions: new Set(ROLES[roleKey].permissions), roles: [roleKey], isPatient: roleKey === "PATIENT", ...extra });

describe("document permissions", () => {
  it("every document category maps to an existing read and upload permission", () => {
    for (const c of DOCUMENT_CATEGORIES) {
      expect(PERMISSIONS[documentPermission(c, "read")], c).toBeDefined();
      expect(PERMISSIONS[documentPermission(c, "upload")], c).toBeDefined();
    }
    expect(documentPermission("UNKNOWN", "read")).toBeNull();
    expect(documentPermission("LAB_REPORT", "delete")).toBeNull();
  });

  it("patients:read / clinical:read alone grant no document access", () => {
    const s = { permissions: new Set(["patients:read", "clinical:read"]), isPatient: false };
    for (const c of DOCUMENT_CATEGORIES) expect(staffCanReadCategory(s, c), c).toBe(false);
    expect(readableCategories(s)).toEqual([]);
  });

  it("separates clinical, lab, imaging, insurance, identity and consent access by role", () => {
    expect(staffCanReadCategory(session("LAB_TECHNICIAN"), "LAB_REPORT")).toBe(true);
    expect(staffCanReadCategory(session("LAB_TECHNICIAN"), "IMAGING_REPORT")).toBe(false);
    expect(staffCanReadCategory(session("LAB_TECHNICIAN"), "INSURANCE")).toBe(false);
    expect(staffCanReadCategory(session("RADIOLOGIST"), "IMAGING_REPORT")).toBe(true);
    expect(staffCanReadCategory(session("RADIOLOGIST"), "LAB_REPORT")).toBe(false);
    expect(staffCanReadCategory(session("RECEPTIONIST"), "ID_DOCUMENT")).toBe(true);
    expect(staffCanReadCategory(session("RECEPTIONIST"), "LAB_REPORT")).toBe(false);
    expect(staffCanReadCategory(session("RECEPTIONIST"), "DISCHARGE_SUMMARY")).toBe(false);
    expect(staffCanReadCategory(session("ACCOUNTANT"), "INSURANCE")).toBe(true);
    expect(staffCanReadCategory(session("ACCOUNTANT"), "REFERRAL")).toBe(false);
    expect(staffCanReadCategory(session("HOSPITAL_ADMIN"), "LAB_REPORT")).toBe(false);
    expect(staffCanReadCategory(session("DOCTOR"), "REFERRAL")).toBe(true);
    expect(staffCanReadCategory(session("DOCTOR"), "INSURANCE")).toBe(false);
    for (const c of DOCUMENT_CATEGORIES) {
      expect(staffCanReadCategory(session("PHARMACIST"), c)).toBe(false);
      expect(staffCanReadCategory(session("HR_MANAGER"), c)).toBe(false);
      expect(staffCanReadCategory(session("SUPER_ADMIN"), c)).toBe(true);
    }
  });

  it("uploads are checked per category", () => {
    expect(staffCanUploadCategory(session("RECEPTIONIST"), "ID_DOCUMENT")).toBe(true);
    expect(staffCanUploadCategory(session("RECEPTIONIST"), "LAB_REPORT")).toBe(false);
    expect(staffCanUploadCategory(session("PHARMACIST"), "OTHER")).toBe(false);
    expect(staffCanUploadCategory(session("LAB_TECHNICIAN"), "LAB_REPORT")).toBe(true);
  });

  it("patients only read their own documents, imaging only once verified", () => {
    const p = { permissions: new Set(["portal:access"]), isPatient: true, patientId: "p1" };
    expect(patientCanRead(p, { patientId: "p1", category: "LAB_REPORT", ownerType: "PATIENT" })).toBe(true);
    expect(patientCanRead(p, { patientId: "p2", category: "LAB_REPORT", ownerType: "PATIENT" })).toBe(false);
    expect(patientCanRead(p, { patientId: "p1", category: "IMAGING_REPORT", ownerType: "IMAGING" })).toBe(false);
    expect(patientCanRead(p, { patientId: "p1", category: "IMAGING_REPORT", ownerType: "IMAGING" }, { imagingVerified: true })).toBe(true);
    expect(patientCanRead({ ...p, patientId: null }, { patientId: null, category: "OTHER" })).toBe(false);
    // Staff rules never apply to patients and vice versa.
    expect(staffCanReadCategory({ ...p, permissions: new Set(["portal:access", "documents.lab:read"]) }, "LAB_REPORT")).toBe(false);
  });

  it("every category is mapped", () => {
    expect(Object.keys(DOCUMENT_CATEGORY_GROUPS).sort()).toEqual([...DOCUMENT_CATEGORIES].sort());
  });
});

describe("hospital-scoped query arguments", () => {
  it("adds the current hospital to reads, updates and deletes of hospital-owned models", () => {
    expect(scopeArgs("Patient", "findMany", { where: { status: "ACTIVE" } }, "H1").where).toEqual({ status: "ACTIVE", hospitalId: "H1" });
    expect(scopeArgs("Patient", "findUnique", { where: { id: "x" } }, "H1").where).toEqual({ id: "x", hospitalId: "H1" });
    expect(scopeArgs("Invoice", "updateMany", {}, "H1").where).toEqual({ hospitalId: "H1" });
    expect(scopeArgs("UploadedDocument", "delete", { where: { id: "d" } }, "H1").where.hospitalId).toBe("H1");
    expect(scopeArgs("AuditLog", "count", undefined, "H1").where).toEqual({ hospitalId: "H1" });
  });

  it("leaves global models alone", () => {
    expect(scopeArgs("User", "findMany", { where: { id: "u" } }, "H1")).toEqual({ where: { id: "u" } });
    expect(isTenantModel("User")).toBe(false);
    expect(isTenantModel("Patient")).toBe(true);
  });

  it("refuses another hospital's id in a filter or in written data", () => {
    expect(() => scopeArgs("Patient", "findMany", { where: { hospitalId: "H2" } }, "H1")).toThrow(TenantContextError);
    expect(() => scopeArgs("Patient", "create", { data: { hospitalId: "H2", mrn: "x" } }, "H1")).toThrow(TenantContextError);
    expect(() => scopeArgs("Patient", "createMany", { data: [{ mrn: "a" }, { hospitalId: "H2", mrn: "b" }] }, "H1")).toThrow(TenantContextError);
    expect(() => scopeArgs("Patient", "upsert", { where: { id: "x" }, create: { hospitalId: "H2" }, update: {} }, "H1")).toThrow(TenantContextError);
    expect(scopeArgs("Patient", "create", { data: { hospitalId: "H1", mrn: "x" } }, "H1").data.hospitalId).toBe("H1");
  });

  it("requires a hospital id to enter a context, and the context is async-scoped", async () => {
    expect(() => runWithTenant({}, () => 1)).toThrow(TenantContextError);
    expect(explicitTenantContext()).toBeNull();
    const inner = await runWithTenant({ hospitalId: "H1" }, async () => { await new Promise((r) => setTimeout(r, 5)); return explicitTenantContext()?.hospitalId; });
    expect(inner).toBe("H1");
    expect(explicitTenantContext()).toBeNull();
  });
});

describe("tenancy model and generated database security", () => {
  it("every model is either hospital-owned or explicitly global", () => {
    const tenants = new Set(tenantModels());
    expect(tenants.size).toBeGreaterThan(55);
    for (const g of GLOBAL_MODELS) expect(tenants.has(g), g).toBe(false);
    for (const must of ["Patient", "Appointment", "Encounter", "Invoice", "UploadedDocument", "AuditLog", "Sequence", "UserRole", "RolePermission", "HospitalMembership", "Notification", "StockMovement", "LabResult"]) {
      expect(tenants.has(must), must).toBe(true);
    }
  });

  it("the committed RLS migration matches the generator (schema and SQL cannot drift)", () => {
    const dirs = fs.readdirSync("prisma/migrations").filter((d) => fs.existsSync(`prisma/migrations/${d}/migration.sql`));
    const generated = dirs.map((d) => fs.readFileSync(`prisma/migrations/${d}/migration.sql`, "utf8")).filter((s) => s.startsWith("-- GENERATED by scripts/db/generate-tenant-security-sql.mjs"));
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.at(-1).replace(/\r\n/g, "\n")).toBe(generateTenantSecuritySql());
  });

  it("platform administration is not a hospital role", () => {
    expect(Object.keys(ROLES)).not.toContain("PLATFORM_ADMIN");
  });
});
