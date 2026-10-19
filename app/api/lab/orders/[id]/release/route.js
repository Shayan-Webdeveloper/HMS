import { route } from "@/lib/api/handler";
import { validateAndRelease } from "@/lib/services/lab";

export const POST = route({ permission: "lab:validate" }, async ({ params, session, ip }) => validateAndRelease(params.id, session, ip));
