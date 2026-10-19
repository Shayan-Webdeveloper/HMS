import { route, ok } from "@/lib/api/handler";
import { listQuery } from "@/lib/validation/common";
import { patientSchema } from "@/lib/validation/patients";
import { listPatients, createPatient } from "@/lib/services/patients";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "patients:read" }, async ({ query }) => {
  const q = query(listQuery);
  const h = await getHospital();
  const { rows, meta } = await listPatients(q, h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "patients:create" }, async ({ body, session, ip }) => {
  const input = await body(patientSchema);
  const p = await createPatient(input, session, ip);
  return ok(p, undefined, { status: 201 });
});
