import { route, ok } from "@/lib/api/handler";
import { invLedgerQuery } from "@/lib/validation/inventory";
import { listInventoryLedger } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "inventory:read" }, async ({ query }) => {
  const q = query(invLedgerQuery);
  const h = await getHospital();
  const { rows, meta } = await listInventoryLedger(q, h.timezone);
  return ok(rows, meta);
});
