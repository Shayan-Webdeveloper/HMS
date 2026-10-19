import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { labTestSchema } from "@/lib/validation/lab";
import { searchActiveTests, createLabTest } from "@/lib/services/lab";

const searchQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
});

// Contract: [{ id, code, name, category, price, specimenType }] — active catalogue only.
export const GET = route({ permission: ["lab:order", "lab:read"] }, async ({ query }) => {
  const { q, pageSize } = query(searchQuery);
  return searchActiveTests({ q, take: pageSize });
});

export const POST = route({ permission: "lab:manage" }, async ({ body, session, ip }) => {
  const input = await body(labTestSchema);
  return ok(await createLabTest(input, session, ip), undefined, { status: 201 });
});
