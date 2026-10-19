import { z } from "zod";
import { route } from "@/lib/api/handler";
import { BED_STATUSES } from "@/lib/validation/inpatient";
import { listBeds } from "@/lib/services/wards";

const q = z.object({
  wardId: z.string().max(64).optional(),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(BED_STATUSES).optional()),
});

// Bed lookup for admission / transfer pickers.
export const GET = route({ permission: ["wards:read", "admissions:create", "admissions:transfer"] }, async ({ query }) => {
  return listBeds(query(q));
});
