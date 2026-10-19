import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { wardSchema, WARD_TYPES } from "@/lib/validation/inpatient";
import { getBedBoard, createWard } from "@/lib/services/wards";

const q = z.object({
  type: z.preprocess((v) => (v === "" ? undefined : v), z.enum(WARD_TYPES).optional()),
  q: z.string().trim().max(100).optional(),
  includeInactive: z.enum(["0", "1"]).optional(),
});

export const GET = route({ permission: "wards:read" }, async ({ query }) => {
  const { type, q: term, includeInactive } = query(q);
  return getBedBoard({ type, q: term, includeInactive: includeInactive === "1" });
});

export const POST = route({ permission: "wards:manage" }, async ({ body, session, ip }) => {
  const input = await body(wardSchema);
  return ok(await createWard(input, session, ip), undefined, { status: 201 });
});
