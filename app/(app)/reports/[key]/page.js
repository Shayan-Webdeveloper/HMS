import { notFound, redirect } from "next/navigation";
import { Download, Info, ArrowLeft } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { getReport, canViewReport, canExportReport, runReport, reportFilterOptions, filterParams, formatCell } from "@/lib/services/reports";
import { formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination, buildHref } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { PrintButton, AutoPrint } from "@/components/reports/PrintButton";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { CategoryBarChart } from "@/components/charts/CategoryBarChart";

const PAGE_SIZE = 50;
const NUMERIC = ["int", "decimal", "money", "percent", "hours"];

export async function generateMetadata({ params }) {
  const { key } = await params;
  return { title: getReport(key)?.title || "Report" };
}

export default async function ReportPage({ params, searchParams }) {
  const session = await requirePageSession("reports:read");
  const { key } = await params;
  const report = getReport(key);
  if (!report) notFound();
  if (!canViewReport(session, report)) redirect("/forbidden");
  const sp = await searchParams;
  const h = await getHospital();
  const [result, options] = await Promise.all([runReport(report, sp, h), reportFilterOptions(report)]);
  const f = result.filters;
  const ctx = { tz: h.timezone, currency: h.currency, locale: h.locale };
  const printView = sp.print === "1";
  const pageCount = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number.parseInt(sp.page, 10) || 1));
  const offset = printView ? 0 : (page - 1) * PAGE_SIZE;
  const rows = (printView ? result.rows : result.rows.slice(offset, offset + PAGE_SIZE)).map((r, i) => ({ ...r, _k: offset + i }));
  const fp = filterParams(report, f);
  const qs = new URLSearchParams(fp).toString();
  const exportHref = canExportReport(session, report) ? `/api/reports/${report.key}/export${qs ? `?${qs}` : ""}` : null;
  const printHref = pageCount > 1 ? buildHref(`/reports/${report.key}`, { ...fp, print: 1 }) : null;
  const chart = result.chart && result.rows.length ? result.chart : null;
  const statusLabel = (report.statusOptions || []).find((o) => o.value === f.status)?.label;
  const deptLabel = options.departments.find((o) => o.value === f.departmentId)?.label;
  const docLabel = options.doctors.find((o) => o.value === f.doctorId)?.label;
  const filterSummary = [
    report.filters.includes("dateRange") && `${formatDateOnly(new Date(`${f.from}T00:00:00Z`))} – ${formatDateOnly(new Date(`${f.to}T00:00:00Z`))}`,
    deptLabel, docLabel, statusLabel && `${report.statusLabel || "Status"}: ${statusLabel}`,
  ].filter(Boolean).join(" · ") || "Current snapshot";

  const columns = report.columns.map((c) => ({
    key: c.key, label: c.label, align: NUMERIC.includes(c.format) ? "right" : undefined,
    render: (r) => (c.format === "status" && r[c.key] ? <StatusBadge status={r[c.key]} /> : formatCell(r[c.key], c.format, ctx)),
  }));

  return (
    <div className="print-doc">
      {printView && <AutoPrint />}
      <div className="hidden print:block mb-4 border-b border-border pb-3">
        <p className="text-[11px] uppercase tracking-wider text-muted">{h.name}</p>
        <h1 className="text-xl font-bold">{report.title}</h1>
        <p className="text-[12px] text-muted">{filterSummary} · Generated {formatDateTime(new Date(), ctx.tz)} by {session.user.name} · Time zone {ctx.tz}</p>
      </div>
      <div className="print:hidden">
        <PageHeader title={report.title} description={report.description}
          actions={<>
            <Button href="/reports" variant="ghost" icon={ArrowLeft}>All reports</Button>
            <PrintButton printHref={printHref} />
            {exportHref && <a href={exportHref} className="btn btn-primary" download><Download size={15} aria-hidden /> Export CSV</a>}
          </>} />
      </div>

      <div className="card mb-5">
        <ReportFilters filters={report.filters} value={{ from: f.from, to: f.to, departmentId: f.departmentId, doctorId: f.doctorId, status: f.status }} today={f.today}
          statusLabel={report.statusLabel} statusOptions={report.statusOptions} defaultStatus={report.defaultStatus} departments={options.departments} doctors={options.doctors} />
        <div className="px-4 py-3 flex items-start gap-2 text-[12.5px] text-muted bg-surface-2 rounded-b-xl">
          <Info size={14} className="mt-0.5 shrink-0 text-info" aria-hidden />
          <p><span className="font-semibold text-ink">Definition.</span> {report.definition} <span className="text-subtle">Showing: {filterSummary}.</span></p>
        </div>
      </div>

      {result.summary?.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
          {result.summary.map((s) => (
            <div key={s.label} className="card px-4 py-3">
              <p className="text-[12px] font-medium text-muted">{s.label}</p>
              <p className="text-[20px] font-bold tracking-tight tabular mt-0.5">{formatCell(s.value, s.format, ctx)}</p>
            </div>
          ))}
        </div>
      )}

      {chart && (
        <div className="card p-4 mb-5 print:break-inside-avoid">
          {chart.kind === "category"
            ? <CategoryBarChart data={chart.data} series={chart.series} stacked={chart.stacked} yLabel={chart.yLabel} money={chart.money} currency={ctx.currency} locale={ctx.locale} ariaLabel={`${report.title} chart`} />
            : <TimeSeriesChart data={chart.data} series={chart.series} kind={chart.kind} stacked={chart.stacked} yLabel={chart.yLabel} money={chart.money} currency={ctx.currency} locale={ctx.locale} ariaLabel={`${report.title} chart`} height={260} />}
        </div>
      )}

      <div className="card">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r._k} caption={report.title}
          empty={<EmptyState title="No data for these filters" description="Try a wider date range or clear the filters." />} />
        {!printView && <div className="no-print"><Pagination path={`/reports/${report.key}`} params={fp} meta={{ total: result.rows.length, page, pageSize: PAGE_SIZE, pageCount }} /></div>}
        {result.truncated && <p className="px-4 py-2 text-xs text-warning border-t border-border">Only the first {result.rows.length.toLocaleString()} rows are shown. Narrow the filters to see everything.</p>}
      </div>
    </div>
  );
}
