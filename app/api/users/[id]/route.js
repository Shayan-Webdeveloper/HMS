import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { updateUserSchema } from "@/lib/validation/users";
import { getUser, updateUser } from "@/lib/services/users";

export const GET = route({ permission: "users:manage" }, async ({ params }) => {
  const u = await getUser(params.id);
  if (!u) throw notFound();
  return u;
});

export const PATCH = route({ permission: "users:manage" }, async ({ params, body, session, ip }) => {
  return updateUser(params.id, await body(updateUserSchema), session, ip);
});
