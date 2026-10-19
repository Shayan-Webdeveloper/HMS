import { route } from "@/lib/api/handler";
import { listBookableDoctors } from "@/lib/services/dashboard";

export const GET = route({ portal: true }, async () => listBookableDoctors());
