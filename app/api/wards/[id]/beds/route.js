import { route, ok } from "@/lib/api/handler";
import { addBedsSchema } from "@/lib/validation/inpatient";
import { addBeds } from "@/lib/services/wards";

export const POST = route({ permission: "wards:manage" }, async ({ params, body, session, ip }) => {
  const { labels } = await body(addBedsSchema);
  return ok(await addBeds(params.id, labels, session, ip), undefined, { status: 201 });
});
