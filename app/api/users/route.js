import { route, ok } from "@/lib/api/handler";
import { userListQuery, createUserSchema } from "@/lib/validation/users";
import { listUsers, createUser } from "@/lib/services/users";

export const GET = route({ permission: "users:manage" }, async ({ query }) => {
  const { rows, meta } = await listUsers(query(userListQuery));
  return ok(rows, meta);
});

// Returns the temporary password exactly once; it is never stored in plain text or logged.
export const POST = route({ permission: "users:manage" }, async ({ body, session, ip }) => {
  const input = await body(createUserSchema);
  const r = await createUser(input, session, ip);
  return ok(r, undefined, { status: 201, headers: { "Cache-Control": "no-store" } });
});
