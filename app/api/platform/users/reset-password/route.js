import { route } from "@/lib/api/handler";
import { platformResetPassword, resetSchema } from "@/lib/services/platform";

export const POST = route({ platform: true }, async ({ body, session, ip }) => platformResetPassword(await body(resetSchema), session, ip));
