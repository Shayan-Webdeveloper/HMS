import { z } from "zod";
import { route } from "@/lib/api/handler";
import { listClinicians } from "@/lib/services/emergency";

const q = z.object({ q: z.string().trim().max(80).optional() });

export const GET = route({ permission: "emergency:read" }, async ({ query }) => {
  const rows = await listClinicians(query(q).q);
  return rows.map((u) => ({ id: u.id, name: u.name, position: u.staff?.position ?? null, department: u.staff?.department?.name ?? null }));
});
