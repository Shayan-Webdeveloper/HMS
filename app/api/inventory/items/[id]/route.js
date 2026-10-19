import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { itemSchema } from "@/lib/validation/inventory";
import { getItem, updateItem } from "@/lib/services/inventory";

export const GET = route({ permission: "inventory:read" }, async ({ params }) => {
  const it = await getItem(params.id);
  if (!it) throw notFound();
  return it;
});

export const PATCH = route({ permission: "inventory:manage" }, async ({ params, body, session, ip }) => {
  const input = await body(itemSchema);
  return updateItem(params.id, input, session, ip);
});
