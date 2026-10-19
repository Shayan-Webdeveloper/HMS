import { route } from "@/lib/api/handler";
import { issueInvoice } from "@/lib/services/billing";

export const POST = route({ permission: "billing:create" }, async ({ params, session, ip }) => issueInvoice(params.id, session, ip));
