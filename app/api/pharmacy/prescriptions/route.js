import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { listQuery } from "@/lib/validation/common";
import { listPrescriptionQueue } from "@/lib/services/pharmacy";
import { getHospital } from "@/lib/services/settings";

// Dispensing queue. Defaults to ACTIVE + PARTIALLY_DISPENSED, oldest first. Drafts are never listed.
export const GET = route({ permission: "prescriptions:read" }, async ({ query }) => {
  const q = query(listQuery.extend({ dir: z.enum(["asc", "desc"]).optional().default("asc") }));
  const h = await getHospital();
  const { rows, meta } = await listPrescriptionQueue(q, h.timezone);
  return ok(rows, meta);
});
