import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { prescriptionCreateSchema } from "@/lib/validation/prescriptions";
import { listPrescriptions, createPrescription } from "@/lib/services/prescriptions";

const listQ = z.object({
  q: z.string().trim().max(60).optional(),
  patientId: z.string().max(64).optional(),
  encounterId: z.string().max(64).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PARTIALLY_DISPENSED", "DISPENSED", "CANCELLED"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
});

export const GET = route({ permission: "prescriptions:read" }, async ({ query }) => {
  const { rows, meta } = await listPrescriptions(query(listQ));
  return ok(rows, meta);
});

// Contract: { patientId, encounterId?, items:[{ medicationId, dose, route, frequency, durationDays, quantity, instructions? }], notes?, finalize }
// Extra: acknowledgeAllergies — required (true) when the basic allergy name match returns 409 ALLERGY_WARNING.
export const POST = route({ permission: "prescriptions:create" }, async ({ body, session, ip }) => {
  const input = await body(prescriptionCreateSchema);
  const rx = await createPrescription(input, session, ip);
  return ok(rx, undefined, { status: 201 });
});
