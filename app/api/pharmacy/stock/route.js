import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { stockQuery } from "@/lib/validation/pharmacy";
import { listStock, pharmacyContext } from "@/lib/services/pharmacy";

// Stock overview. status = low | out | expiring | expired (expiry window from settings pharmacy.expiryAlertDays).
export const GET = route({ permission: "pharmacy:read" }, async ({ query }) => {
  const q = query(stockQuery.extend({ dir: z.enum(["asc", "desc"]).optional().default("asc") }));
  const ctx = await pharmacyContext();
  const { rows, meta } = await listStock(q, ctx);
  return ok(rows, { ...meta, today: ctx.today, expiryAlertDays: ctx.alertDays });
});
