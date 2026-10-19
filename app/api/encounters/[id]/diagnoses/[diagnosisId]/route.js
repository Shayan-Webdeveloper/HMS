import { route } from "@/lib/api/handler";
import { removeDiagnosis } from "@/lib/services/encounters";

// Only while the encounter is an unsigned DRAFT (enforced in the service).
export const DELETE = route({ permission: "encounters:create" }, async ({ params, session, ip }) => removeDiagnosis(params.id, params.diagnosisId, session, ip));
