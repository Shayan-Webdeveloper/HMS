import { route } from "@/lib/api/handler";
import { startConsultation } from "@/lib/services/encounters";

// CHECKED_IN → IN_PROGRESS; creates or re-opens the DRAFT encounter. Doctor only (enforced in the service).
export const POST = route({ permission: "encounters:create" }, async ({ params, session, ip }) => startConsultation(params.id, session, ip));
