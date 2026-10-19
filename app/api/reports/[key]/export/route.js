import { route } from "@/lib/api/handler";
import { notFound, forbidden } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/utils/csv";
import { getReport, canViewReport, runReport, csvColumns, filterParams } from "@/lib/services/reports";
import { getHospital } from "@/lib/services/settings";

// CSV export (formula-injection safe via toCsv, capped at MAX_EXPORT_ROWS by runReport). Every export is audited.
export const GET = route({ permission: ["reports:export"] }, async ({ params, query, session, ip }) => {
  const report = getReport(params.key);
  if (!report) throw notFound("Report not found");
  if (!canViewReport(session, report)) throw forbidden();
  const h = await getHospital();
  const result = await runReport(report, query(), h);
  const filters = filterParams(report, result.filters);
  await audit({ userId: session.user.id, action: "report.export", entityType: "Report", entityId: report.key, metadata: { filters, rows: result.rows.length, truncated: result.truncated }, ipAddress: ip });
  const csv = toCsv(csvColumns(report, { tz: h.timezone, currency: h.currency }), result.rows);
  const stamp = report.filters.includes("dateRange") ? `${result.filters.from}_to_${result.filters.to}` : result.filters.today;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report.key}-${stamp}.csv"`,
      "X-Total-Rows": String(result.rows.length),
      "Cache-Control": "no-store",
    },
  });
});
