import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { getPrescriptionForDispensing, pharmacyContext } from "@/lib/services/pharmacy";

export const GET = route({ permission: "prescriptions:read" }, async ({ params, session, ip }) => {
  const rx = await getPrescriptionForDispensing(params.id, await pharmacyContext());
  if (!rx) throw notFound();
  await audit({ userId: session.user.id, action: "prescription.view", entityType: "Prescription", entityId: rx.id, ipAddress: ip });
  return rx;
});
