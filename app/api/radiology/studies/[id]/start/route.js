import { route } from "@/lib/api/handler";
import { startStudy } from "@/lib/services/radiology";

export const POST = route({ permission: "radiology:report" }, async ({ params, session, ip }) => startStudy(params.id, session, ip));
