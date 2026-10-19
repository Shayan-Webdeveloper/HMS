import { describe, it, expect } from "vitest";
import { ROLES, PERMISSIONS } from "@/lib/permissions/matrix";
import { filterNav } from "@/lib/navigation";

describe("permission matrix", () => {
  it("only grants known permissions", () => {
    for (const [role, r] of Object.entries(ROLES)) for (const p of r.permissions) expect(PERMISSIONS[p], `${role}: ${p}`).toBeDefined();
  });
  it("patients get portal access only", () => {
    expect(ROLES.PATIENT.permissions).toEqual(["portal:access"]);
  });
  it("receptionists cannot finalize encounters or release lab results", () => {
    expect(ROLES.RECEPTIONIST.permissions).not.toContain("encounters:finalize");
    expect(ROLES.RECEPTIONIST.permissions).not.toContain("lab:validate");
    expect(ROLES.RECEPTIONIST.permissions).not.toContain("clinical:read");
  });
  it("pharmacists cannot see billing or clinical notes", () => {
    expect(ROLES.PHARMACIST.permissions).not.toContain("billing:read");
    expect(ROLES.PHARMACIST.permissions).not.toContain("clinical:read");
  });
  it("navigation hides modules without permission", () => {
    const nav = filterNav(ROLES.LAB_TECHNICIAN.permissions).flatMap((g) => g.items.map((i) => i.href));
    expect(nav).toContain("/laboratory");
    expect(nav).not.toContain("/billing");
    expect(nav).not.toContain("/settings");
  });
});
