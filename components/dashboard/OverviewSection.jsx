import Link from "next/link";
import { Users, UserPlus, CalendarDays, CalendarCheck2, CalendarX2, BedDouble, BedSingle, IdCard, FlaskConical, Pill, Receipt, Wallet, Siren, ClipboardPlus, BarChart3, ScrollText, Settings, Activity } from "lucide-react";
import { can } from "@/lib/auth/session";
import { loadOverview, computeTrend } from "@/lib/services/dashboard";
import { formatMoney } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/time";
import { MetricCard } from "@/components/ui/MetricCard";
import { Badge } from "@/components/ui/Badge";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { CategoryBarChart } from "@/components/charts/CategoryBarChart";
import { KpiGrid, Panel, PanelLink, RowList, QuickActions, fmtInt } from "./Widgets";

export async function OverviewSection({ session, ctx }) {
  const d = await loadOverview(session, ctx);
  const money = (v) => formatMoney(v, ctx.currency, ctx.locale);
  const beds = d.beds;
  const occupied = beds.OCCUPIED || 0, available = beds.AVAILABLE || 0;
  const totalBeds = Object.values(beds).reduce((s, n) => s + n, 0);
  const href = (perm, url) => (can(session, perm) ? url : undefined);
  const charts = d.charts;
  const periodLabel = ctx.period.label.toLowerCase();

  const alerts = [
    d.statPending > 0 && { key: "stat", tone: "danger", icon: FlaskConical, text: `${d.statPending} STAT lab order${d.statPending === 1 ? "" : "s"} pending`, href: href("lab:read", "/laboratory?priority=STAT") },
    d.waitingTriage > 0 && { key: "triage", tone: "danger", icon: Siren, text: `${d.waitingTriage} emergency patient${d.waitingTriage === 1 ? "" : "s"} waiting for triage`, href: href("emergency:read", "/emergency") },
    d.expiredWithStock > 0 && { key: "expired", tone: "danger", icon: Pill, text: `${d.expiredWithStock} expired batch${d.expiredWithStock === 1 ? "" : "es"} still in stock`, href: href("pharmacy:read", "/pharmacy?tab=stock&status=expired") },
    d.lowStockCount > 0 && { key: "low", tone: "warning", icon: Pill, text: `${d.lowStockCount} medicine${d.lowStockCount === 1 ? "" : "s"} at or below reorder level`, href: href("pharmacy:read", "/pharmacy?tab=stock&status=low") },
    d.expiringCount > 0 && { key: "expiring", tone: "warning", icon: Pill, text: `${d.expiringCount} batch${d.expiringCount === 1 ? "" : "es"} expire within ${d.expiryDays} days`, href: href("pharmacy:read", "/pharmacy?tab=stock&status=expiring") },
    (beds.OUT_OF_SERVICE || 0) > 0 && { key: "oos", tone: "neutral", icon: BedSingle, text: `${beds.OUT_OF_SERVICE} bed${beds.OUT_OF_SERVICE === 1 ? "" : "s"} out of service`, href: href("wards:read", "/wards") },
  ].filter(Boolean);

  const actions = [
    can(session, "patients:create") && { href: "/patients/new", label: "Register patient", icon: UserPlus },
    can(session, "appointments:create") && { href: "/appointments/new", label: "Book appointment", icon: CalendarDays },
    can(session, "emergency:manage") && { href: "/emergency", label: "Emergency desk", icon: Siren },
    can(session, "admissions:create") && { href: "/admissions", label: "Admissions", icon: BedDouble },
    can(session, "billing:create") && { href: "/billing", label: "Billing", icon: Receipt },
    can(session, "reports:read") && { href: "/reports", label: "Reports", icon: BarChart3 },
    can(session, "users:manage") && { href: "/settings?tab=users", label: "Users & roles", icon: Settings },
    can(session, "audit:read") && { href: "/audit-logs", label: "Audit logs", icon: ScrollText },
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <KpiGrid>
        <MetricCard label="Active patients" value={fmtInt(d.totalPatients)} icon={Users} hint="registered records" href={href("patients:read", "/patients")} />
        <MetricCard label="New patients" value={fmtInt(d.newPatients)} icon={UserPlus} tone="teal" trend={computeTrend(d.newPatients, d.newPatientsPrev)} />
        <MetricCard label="Today's appointments" value={fmtInt(d.todayAppts)} icon={CalendarDays} tone="info" hint={`${fmtInt(d.todayCompleted)} completed so far`} href={href("appointments:read", "/appointments")} />
        <MetricCard label="Completed appointments" value={fmtInt(d.completed)} icon={CalendarCheck2} tone="success" trend={computeTrend(d.completed, d.completedPrev)} />
        <MetricCard label="Cancelled appointments" value={fmtInt(d.cancelled)} icon={CalendarX2} tone="danger" hint={`${fmtInt(d.cancelledPrev)} in previous period`} />
        <MetricCard label="Current admissions" value={fmtInt(d.currentAdmissions)} icon={BedDouble} tone="primary" hint={totalBeds ? `${Math.round((occupied / Math.max(1, totalBeds - (beds.OUT_OF_SERVICE || 0))) * 100)}% of in-service beds occupied` : undefined} href={href("admissions:read", "/admissions")} />
        <MetricCard label="Beds available" value={`${fmtInt(available)} / ${fmtInt(totalBeds)}`} icon={BedSingle} tone="teal" hint={`${fmtInt(occupied)} occupied · ${fmtInt(beds.CLEANING || 0)} cleaning`} href={href("wards:read", "/wards")} />
        <MetricCard label="Staff on duty today" value={fmtInt(d.staffOnDuty)} icon={IdCard} tone="info" hint={`${fmtInt(d.doctorsToday)} doctors holding clinic`} href={href(["staff:read", "hr:read"], "/staff")} />
        <MetricCard label="Pending lab tests" value={fmtInt(d.pendingLabTests)} icon={FlaskConical} tone="warning" hint={`${fmtInt(d.pendingLabOrders)} orders · ${fmtInt(d.statPending)} STAT`} href={href("lab:read", "/laboratory")} />
        <MetricCard label="Low-stock medicines" value={fmtInt(d.lowStockCount)} icon={Pill} tone={d.lowStockCount ? "danger" : "success"} hint={`${fmtInt(d.expiringCount)} batches expiring ≤ ${d.expiryDays} d`} href={href("pharmacy:read", "/pharmacy?tab=stock&status=low")} />
        {d.finance && <MetricCard label="Outstanding invoices" value={money(d.finance.outstandingBalance)} icon={Receipt} tone="warning" hint={`${fmtInt(d.finance.outstandingCount)} invoices with a balance`} href={href("billing:read", "/billing")} />}
        {d.finance && <MetricCard label="Revenue collected" value={money(d.finance.revenue.net)} icon={Wallet} tone="success" trend={computeTrend(d.finance.revenue.net, d.finance.revenuePrev.net)} hint="payments − refunds" />}
      </KpiGrid>

      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Appointments per day" description={`By scheduled date, ${periodLabel}`} className="lg:col-span-2" bodyClassName="p-4">
          <TimeSeriesChart data={charts.appointments} stacked yLabel="Appointments" ariaLabel="Appointments per day by status"
            series={[{ key: "completed", label: "Completed", color: "primary" }, { key: "open", label: "Scheduled / in progress", color: "teal" }, { key: "cancelled", label: "Cancelled / no-show", color: "slate" }]} />
        </Panel>
        <Panel title="Appointments by department" description="Excludes cancelled" bodyClassName="p-4">
          {charts.departments.length ? <CategoryBarChart data={charts.departments} series={[{ key: "n", label: "Appointments", color: "primary" }]} yLabel="Appointments" labelWidth={120} ariaLabel="Appointments by department" />
            : <p className="py-10 text-center text-[13px] text-muted">No appointments in this period.</p>}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="New registrations per day" bodyClassName="p-4">
          <TimeSeriesChart data={charts.registrations} series={[{ key: "n", label: "Registrations", color: "teal" }]} yLabel="Patients" ariaLabel="New patient registrations per day" />
        </Panel>
        <Panel title="Admissions vs discharges" bodyClassName="p-4">
          <TimeSeriesChart kind="line" data={charts.admissions} series={[{ key: "admissions", label: "Admissions", color: "primary" }, { key: "discharges", label: "Discharges", color: "amber" }]} yLabel="Patients" ariaLabel="Admissions and discharges per day" />
        </Panel>
      </div>

      {charts.revenue && (
        <Panel title="Revenue collected per day" description="Payments received minus refunds, by payment date (hospital time zone)" bodyClassName="p-4" action={<PanelLink href={href("reports:financial", "/reports/payment-collections")}>Collections report</PanelLink>}>
          <TimeSeriesChart data={charts.revenue} series={[{ key: "net", label: "Net collected", color: "teal" }]} yLabel="Amount" money currency={ctx.currency} locale={ctx.locale} ariaLabel="Net revenue collected per day" />
        </Panel>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Operational alerts" action={alerts.length ? <Badge tone="danger" plain>{alerts.length}</Badge> : null}>
          {alerts.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-muted">No alerts right now.</p> : (
            <ul className="divide-y divide-border">
              {alerts.map((a) => {
                const body = (
                  <span className="flex items-start gap-2.5">
                    <span className={`mt-0.5 w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${a.tone === "danger" ? "bg-danger-soft text-danger" : a.tone === "warning" ? "bg-warning-soft text-warning" : "bg-neutral-soft text-muted"}`}><a.icon size={15} aria-hidden /></span>
                    <span className="text-[13.5px] pt-1">{a.text}</span>
                  </span>
                );
                return <li key={a.key} className="px-4 py-2.5">{a.href ? <Link href={a.href} className="block hover:text-primary">{body}</Link> : body}</li>;
              })}
            </ul>
          )}
        </Panel>
        {d.recentActivity ? (
          <Panel title="Recent activity" description="Latest audited actions" action={<PanelLink href="/audit-logs" />}>
            <RowList empty="No activity recorded yet." items={d.recentActivity.map((a) => ({
              key: a.id, title: <span className="inline-flex items-center gap-1.5"><Activity size={13} className="text-subtle" aria-hidden /><code className="text-[12px]">{a.action}</code></span>,
              sub: `${a.user?.name || "System"} · ${a.entityType}`, right: <span className="text-xs text-subtle whitespace-nowrap">{formatDateTime(a.createdAt, ctx.tz)}</span>,
            }))} />
          </Panel>
        ) : (
          <Panel title="Today at a glance">
            <RowList items={[
              { key: "a", title: "Appointments today", right: <span className="font-semibold tabular">{fmtInt(d.todayAppts)}</span> },
              { key: "b", title: "Beds occupied", right: <span className="font-semibold tabular">{fmtInt(occupied)}</span> },
              { key: "c", title: "Staff on duty", right: <span className="font-semibold tabular">{fmtInt(d.staffOnDuty)}</span> },
            ]} />
          </Panel>
        )}
        <Panel title="Quick actions" action={<ClipboardPlus size={16} className="text-subtle" aria-hidden />}>
          {actions.length ? <QuickActions actions={actions} /> : <p className="px-4 py-8 text-center text-[13px] text-muted">No quick actions for your role.</p>}
        </Panel>
      </div>
    </div>
  );
}
