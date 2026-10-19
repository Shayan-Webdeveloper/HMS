import { route, ok } from "@/lib/api/handler";
import { medLedgerQuery } from "@/lib/validation/pharmacy";
import { listMedicationLedger } from "@/lib/services/pharmacy";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "pharmacy:read" }, async ({ query }) => {
  const q = query(medLedgerQuery);
  const h = await getHospital();
  const { rows, meta } = await listMedicationLedger(q, h.timezone);
  return ok(rows, meta);
});
