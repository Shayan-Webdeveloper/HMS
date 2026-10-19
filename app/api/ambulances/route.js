import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { ambulanceSchema, AMBULANCE_STATUSES } from "@/lib/validation/emergency";
import { listAmbulances, createAmbulance } from "@/lib/services/ambulances";

const q = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(AMBULANCE_STATUSES).optional()),
});

export const GET = route({ permission: "ambulance:read" }, async ({ query }) => listAmbulances(query(q)));

export const POST = route({ permission: "ambulance:manage" }, async ({ body, session, ip }) => {
  const input = await body(ambulanceSchema);
  return ok(await createAmbulance(input, session, ip), undefined, { status: 201 });
});
