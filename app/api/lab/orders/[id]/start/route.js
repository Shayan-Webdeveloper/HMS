import { route } from "@/lib/api/handler";
import { startProcessing } from "@/lib/services/lab";

export const POST = route({ permission: "lab:process" }, async ({ params, session, ip }) => startProcessing(params.id, session, ip));
