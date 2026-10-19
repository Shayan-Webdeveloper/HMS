import { route } from "@/lib/api/handler";
import { portalBilling } from "@/lib/services/dashboard";

export const GET = route({ portal: true }, async ({ session }) => portalBilling(session.patientId));
