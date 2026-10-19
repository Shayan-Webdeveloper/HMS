import { route } from "@/lib/api/handler";
import { can } from "@/lib/auth/session";
import { getAdmission } from "@/lib/services/admissions";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";

export const GET = route({ permission: "admissions:read" }, async ({ params, session, ip }) => {
  const a = await getAdmission(params.id);
  if (!a) throw notFound();
  await audit({ userId: session.user.id, action: "admission.view", entityType: "Admission", entityId: a.id, ipAddress: ip });
  // Clinical narrative is only returned to users who may read clinical records.
  if (!can(session, "clinical:read")) return { ...a, dischargeSummary: a.dischargeSummary ? "[restricted]" : null };
  return a;
});
