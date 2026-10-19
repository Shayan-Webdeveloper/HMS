import { route } from "@/lib/api/handler";
import { portalPrescriptions } from "@/lib/services/dashboard";

export const GET = route({ portal: true }, async ({ session }) => portalPrescriptions(session.patientId));
