import { route } from "@/lib/api/handler";
import { collectSpecimen } from "@/lib/services/lab";

export const POST = route({ permission: "lab:process" }, async ({ params, session, ip }) => collectSpecimen(params.id, session, ip));
