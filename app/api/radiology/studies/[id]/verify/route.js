import { route } from "@/lib/api/handler";
import { verifyReport } from "@/lib/services/radiology";

export const POST = route({ permission: "radiology:verify" }, async ({ params, session, ip }) => verifyReport(params.id, session, ip));
