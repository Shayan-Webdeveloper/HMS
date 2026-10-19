import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { medicationSchema } from "@/lib/validation/pharmacy";
import { getMedication, updateMedication, pharmacyContext } from "@/lib/services/pharmacy";

export const GET = route({ permission: "pharmacy:read" }, async ({ params }) => {
  const m = await getMedication(params.id, await pharmacyContext());
  if (!m) throw notFound();
  return m;
});

export const PATCH = route({ permission: "pharmacy:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(medicationSchema);
  return updateMedication(params.id, input, session, ip);
});
