import { route } from "@/lib/api/handler";
import { listPlatformAudit } from "@/lib/services/platform";

export const GET = route({ platform: true }, async () => listPlatformAudit());
