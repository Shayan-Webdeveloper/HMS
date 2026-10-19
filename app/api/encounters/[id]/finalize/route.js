import { route } from "@/lib/api/handler";
import { finalizeEncounter } from "@/lib/services/encounters";

export const POST = route({ permission: "encounters:finalize" }, async ({ params, session, ip }) => finalizeEncounter(params.id, session, ip));
