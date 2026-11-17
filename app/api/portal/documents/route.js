import { route } from "@/lib/api/handler";
import { listPortalDocuments } from "@/lib/services/documents";

// Metadata only; files are downloaded through /api/documents/[id], which re-checks every rule.
export const GET = route({ portal: true }, async ({ session }) => listPortalDocuments(session));
