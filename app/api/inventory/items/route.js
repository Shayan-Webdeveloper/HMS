import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { itemsQuery, itemSchema } from "@/lib/validation/inventory";
import { listItems, createItem } from "@/lib/services/inventory";

// status = ACTIVE | INACTIVE (default: all); stock = low | out. meta.totals carries the valuation of the filtered set.
export const GET = route({ permission: "inventory:read" }, async ({ query }) => {
  const q = query(itemsQuery.extend({ dir: z.enum(["asc", "desc"]).optional().default("asc") }));
  const { rows, meta, totals } = await listItems(q);
  return ok(rows, { ...meta, totals });
});

export const POST = route({ permission: "inventory:manage" }, async ({ body, session, ip }) => {
  const input = await body(itemSchema);
  return ok(await createItem(input, session, ip), undefined, { status: 201 });
});
