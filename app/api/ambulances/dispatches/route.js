import { z } from "zod";
import { route, ok } from "@/lib/api/handler";
import { listQuery } from "@/lib/validation/common";
import { dispatchSchema, DISPATCH_STATUSES } from "@/lib/validation/emergency";
import { listDispatches, createDispatch } from "@/lib/services/ambulances";
import { getHospital } from "@/lib/services/settings";
import { can } from "@/lib/auth/session";
import { forbidden } from "@/lib/errors";

const extra = z.object({ status: z.preprocess((v) => (v === "" ? undefined : v), z.enum([...DISPATCH_STATUSES, "ACTIVE"]).optional()) });

export const GET = route({ permission: "ambulance:read" }, async ({ query }) => {
  const base = query(listQuery);
  const { status } = query(extra);
  const h = await getHospital();
  const { rows, meta } = await listDispatches({ ...base, status }, h.timezone);
  return ok(rows, meta);
});

export const POST = route({ permission: "ambulance:manage" }, async ({ body, session, ip }) => {
  const input = await body(dispatchSchema);
  // Linking to an ER visit touches emergency records.
  if (input.emergencyVisitId && !can(session, "emergency:read")) throw forbidden("Linking a dispatch to an ER visit requires emergency access.");
  return ok(await createDispatch(input, session, ip), undefined, { status: 201 });
});
