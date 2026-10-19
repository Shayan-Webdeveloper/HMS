import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { listQuery } from "@/lib/validation/common";
import { erRegisterSchema, ER_STATUSES } from "@/lib/validation/emergency";
import { getActiveBoard, listClosedVisits, registerVisit } from "@/lib/services/emergency";
import { getHospital } from "@/lib/services/settings";

const extra = z.object({
  view: z.enum(["board", "closed"]).optional().default("board"),
  category: z.string().max(30).optional(),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(ER_STATUSES).optional()),
});

export const GET = route({ permission: "emergency:read" }, async ({ query }) => {
  const { view, category, status } = query(extra);
  const base = query(listQuery);
  if (view === "board") return getActiveBoard({ q: base.q, status, category });
  const h = await getHospital();
  const { rows, meta } = await listClosedVisits({ ...base, status }, h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "emergency:manage" }, async ({ body, session, ip }) => {
  const input = await body(erRegisterSchema);
  return ok(await registerVisit(input, session, ip), undefined, { status: 201 });
});
