import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { portalProfileSchema } from "@/lib/validation/portal";
import { portalProfile, updatePortalProfile } from "@/lib/services/dashboard";

export const GET = route({ portal: true }, async ({ session }) => {
  const p = await portalProfile(session.patientId);
  if (!p) throw notFound();
  return p;
});

// Patients may update contact details and communication consents only.
export const PATCH = route({ portal: true }, async ({ body, session, ip }) => {
  return updatePortalProfile(await body(portalProfileSchema), session, ip);
});
