import { route, ok } from "@/lib/api/handler";
import { notFound, forbidden } from "@/lib/errors";
import { getReport, canViewReport, runReport } from "@/lib/services/reports";
import { getHospital } from "@/lib/services/settings";

// JSON report data — the same implementation as the report page and the CSV export.
export const GET = route({ permission: "reports:read" }, async ({ params, query, session }) => {
  const report = getReport(params.key);
  if (!report) throw notFound("Report not found");
  if (!canViewReport(session, report)) throw forbidden();
  const result = await runReport(report, query(), await getHospital());
  const { start, end, days, now, ...filters } = result.filters;
  return ok({ key: report.key, title: report.title, definition: report.definition, columns: report.columns, summary: result.summary, chart: result.chart ?? null, rows: result.rows }, { filters, rows: result.rows.length, truncated: result.truncated });
});
