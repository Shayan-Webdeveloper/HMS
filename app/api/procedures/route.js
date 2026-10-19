import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { listQuery, optionalDate } from "@/lib/validation/common";
import { procedureSchema, PROCEDURE_STATUSES } from "@/lib/validation/procedures";
import { listProcedures, listDaySchedule, scheduleProcedure } from "@/lib/services/procedures";
import { getHospital } from "@/lib/services/settings";

const extra = z.object({
  date: optionalDate,
  theatreId: z.string().max(64).optional(),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(PROCEDURE_STATUSES).optional()),
});

export const GET = route({ permission: "procedures:read" }, async ({ query }) => {
  const base = query(listQuery);
  const { date, theatreId, status } = query(extra);
  const h = await getHospital();
  if (date) return listDaySchedule(date, { theatreId, status, q: base.q }, h.timezone);
  const { rows, meta } = await listProcedures({ ...base, status, theatreId, sort: base.sort || "scheduledStart" }, h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "procedures:manage" }, async ({ body, session, ip }) => {
  const input = await body(procedureSchema);
  return ok(await scheduleProcedure(input, session, ip), undefined, { status: 201 });
});
