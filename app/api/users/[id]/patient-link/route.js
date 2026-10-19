import { route } from "@/lib/api/handler";
import { patientLinkSchema } from "@/lib/validation/users";
import { linkPatient, unlinkPatient } from "@/lib/services/users";

// Link a PATIENT-role account to a patient record (verified now) for portal access.
export const POST = route({ permission: "users:manage" }, async ({ params, body, session, ip }) => {
  const { mrn } = await body(patientLinkSchema);
  return linkPatient(params.id, mrn, session, ip);
});

export const DELETE = route({ permission: "users:manage" }, async ({ params, session, ip }) => {
  return unlinkPatient(params.id, session, ip);
});
