import { route } from "@/lib/api/handler";
import { portalOverview } from "@/lib/services/dashboard";

export const GET = route({ portal: true }, async ({ session }) => portalOverview(session.patientId, session.user.id));
