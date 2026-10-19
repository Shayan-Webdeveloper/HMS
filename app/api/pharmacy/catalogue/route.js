import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { catalogueQuery } from "@/lib/validation/pharmacy";
import { listCatalogue } from "@/lib/services/pharmacy";

// Full medication catalogue (paginated). status = ACTIVE | INACTIVE (default: all); form = dosage form.
export const GET = route({ permission: "pharmacy:read" }, async ({ query }) => {
  const q = query(catalogueQuery.extend({ dir: z.enum(["asc", "desc"]).optional().default("asc") }));
  const { rows, meta } = await listCatalogue(q);
  return ok(rows, meta);
});
