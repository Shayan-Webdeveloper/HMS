import { route, ok } from "@/lib/api/handler";
import { medicationLookupQuery, medicationSchema } from "@/lib/validation/pharmacy";
import { lookupMedications, createMedication, pharmacyContext } from "@/lib/services/pharmacy";

// Cross-module contract (used by the prescribing UI):
// GET /api/pharmacy/medications?q= → [{ id, code, genericName, brandName, strength, dosageForm, sellingPrice, onHand }]
// onHand = sum of quantities in non-expired batches. Inactive medicines are excluded unless includeInactive=1.
export const GET = route({ permission: ["pharmacy:read", "prescriptions:create"] }, async ({ query }) => {
  const q = query(medicationLookupQuery);
  const ctx = await pharmacyContext();
  return lookupMedications(q, ctx);
});

export const POST = route({ permission: "pharmacy:manage" }, async ({ body, session, ip }) => {
  const input = await body(medicationSchema);
  const m = await createMedication(input, session, ip);
  return ok(m, undefined, { status: 201 });
});
