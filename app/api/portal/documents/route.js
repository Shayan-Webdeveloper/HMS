import { route } from "@/lib/api/handler";
import { portalDocuments } from "@/lib/services/dashboard";

// Metadata only; files are downloaded through /api/documents/[id], which re-checks ownership.
export const GET = route({ portal: true }, async ({ session }) => portalDocuments(session.patientId));
