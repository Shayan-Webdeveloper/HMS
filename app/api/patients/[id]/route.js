import { route } from "@/lib/api/handler";
import { patientSchema } from "@/lib/validation/patients";
import { getPatientProfile, updatePatient } from "@/lib/services/patients";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";

export const GET = route({ permission: "patients:read" }, async ({ params, session, ip }) => {
  const p = await getPatientProfile(params.id);
  if (!p) throw notFound();
  await audit({ userId: session.user.id, action: "patient.view", entityType: "Patient", entityId: p.id, ipAddress: ip });
  return p;
});

export const PATCH = route({ permission: "patients:update" }, async ({ params, body, session, ip }) => {
  const input = await body(patientSchema);
  return updatePatient(params.id, input, session, ip);
});
