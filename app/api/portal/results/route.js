import { route } from "@/lib/api/handler";
import { portalResults } from "@/lib/services/dashboard";

// Released lab orders (current results only) and verified imaging reports.
export const GET = route({ portal: true }, async ({ session }) => portalResults(session.patientId));
