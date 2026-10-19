import { route, ok } from "@/lib/api/handler";
import { listQuery } from "@/lib/validation/common";
import { admissionSchema, admissionListQuery } from "@/lib/validation/inpatient";
import { listAdmissions, admitPatient } from "@/lib/services/admissions";

export const GET = route({ permission: "admissions:read" }, async ({ query }) => {
  const base = query(listQuery);
  const extra = query(admissionListQuery);
  const { rows, meta } = await listAdmissions({ ...base, ...extra, sort: base.sort || "admittedAt" });
  return ok(rows, meta);
});

export const POST = route({ permission: "admissions:create" }, async ({ body, session, ip }) => {
  const input = await body(admissionSchema);
  return ok(await admitPatient(input, session, ip), undefined, { status: 201 });
});
