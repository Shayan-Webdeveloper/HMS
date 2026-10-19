import { route } from "@/lib/api/handler";
import { reportsFor } from "@/lib/services/reports";

// Reports the signed-in user may open (financial / HR reports only appear with those permissions).
export const GET = route({ permission: "reports:read" }, async ({ session }) => {
  return reportsFor(session).map((r) => ({
    key: r.key, title: r.title, category: r.category, description: r.description, definition: r.definition,
    financial: r.requires.includes("reports:financial"), filters: r.filters, statusOptions: r.statusOptions ?? [],
    columns: r.columns.map(({ key, label, format }) => ({ key, label, format: format ?? "text" })),
    exportable: session.permissions.has("reports:export"),
  }));
});
