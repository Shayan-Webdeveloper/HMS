import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/session";
import { getImagingStudy, redactImagingStudy } from "@/lib/services/radiology";

export const GET = route({ permission: "radiology:read" }, async ({ params, session, ip }) => {
  const s = await getImagingStudy(params.id);
  if (!s) throw notFound("Imaging study not found");
  await audit({ userId: session.user.id, action: "imaging.study.view", entityType: "ImagingStudy", entityId: s.id, ipAddress: ip });
  return redactImagingStudy(s, can(session, ["radiology:report", "radiology:verify"]));
});
