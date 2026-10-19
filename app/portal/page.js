import Link from "next/link";
import { CalendarDays, Stethoscope, Pill, FlaskConical, Receipt, Bell, FileText, KeyRound } from "lucide-react";
import { requirePortalSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { portalOverview } from "@/lib/services/dashboard";
import { formatMoney } from "@/lib/utils/money";
import { formatDateTime, formatDate } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusBadge } from "@/components/ui/Badge";
import { Panel, PanelLink, RowList, KpiGrid } from "@/components/dashboard/Widgets";

export const metadata = { title: "My dashboard" };

const dr = (d) => (d?.staff ? `Dr. ${d.staff.firstName} ${d.staff.lastName}` : "—");

export default async function PortalHome() {
  const session = await requirePortalSession();
  const h = await getHospital();
  const tz = h.timezone;
  const d = await portalOverview(session.patientId, session.user.id);
  const money = (v) => formatMoney(v, h.currency, h.locale);

  return (
    <>
      <PageHeader title={`Hello, ${d.patient?.firstName ?? session.user.name}`} description={`Medical record number ${d.patient?.mrn ?? "—"} · ${h.name}`} />
      {session.user.mustChangePassword && (
        <div role="alert" className="mb-5 rounded-lg border border-warning/30 bg-warning-soft text-warning px-4 py-3 text-[13.5px] font-medium flex items-center gap-2">
          <KeyRound size={16} aria-hidden /> You are using a temporary password. <Link href="/portal/profile#password" className="underline font-semibold">Set a new password</Link>
        </div>
      )}
      <KpiGrid className="mb-5">
        <MetricCard label="Upcoming appointments" value={d.upcoming.length} icon={CalendarDays} href="/portal/appointments" />
        <MetricCard label="Active prescriptions" value={d.prescriptions.length} icon={Pill} tone="teal" href="/portal/prescriptions" />
        <MetricCard label="New results (30 days)" value={d.results.length} icon={FlaskConical} tone="info" href="/portal/results" />
        <MetricCard label="Amount due" value={money(d.outstanding)} icon={Receipt} tone={Number(d.outstanding) > 0 ? "warning" : "success"} hint={`${d.invoices.length} open invoice${d.invoices.length === 1 ? "" : "s"}`} href="/portal/billing" />
      </KpiGrid>
      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Upcoming appointments" action={<PanelLink href="/portal/appointments">Manage</PanelLink>}>
          <RowList empty="No upcoming appointments." items={d.upcoming.map((a) => ({
            key: a.id, title: `${dr(a.doctor)} · ${a.department.name}`,
            sub: a.status === "REQUESTED" ? `Requested for ${formatDate(a.startsAt, tz)} — the hospital will confirm a time` : formatDateTime(a.startsAt, tz),
            right: <StatusBadge status={a.status} />,
          }))} />
        </Panel>
        <Panel title="Recent visits" description="Signed consultation records">
          <RowList empty="No visits recorded yet." items={d.visits.map((e) => ({
            key: e.id, title: `${formatDate(e.startedAt, tz)} · ${dr(e.doctor)}`,
            sub: e.diagnoses.length ? e.diagnoses.map((x) => x.description).join("; ") : `${e.department.name} visit`,
            right: <span className="text-xs text-subtle inline-flex items-center gap-1"><Stethoscope size={12} aria-hidden />{e.type}</span>,
          }))} />
        </Panel>
        <Panel title="Active prescriptions" action={<PanelLink href="/portal/prescriptions" />}>
          <RowList empty="No active prescriptions." items={d.prescriptions.map((p) => ({
            key: p.id, title: p.items.map((i) => `${i.medication.genericName} ${i.medication.strength}`).join(", ") || p.prescriptionNo,
            sub: `${p.prescriptionNo} · ${formatDate(p.issuedAt, tz)}`, right: <StatusBadge status={p.status} />,
          }))} />
        </Panel>
        <Panel title="Newly released results" action={<PanelLink href="/portal/results" />}>
          <RowList empty="No new results in the last 30 days." items={d.results.map((o) => ({
            key: o.id, href: "/portal/results", title: o.items.map((i) => i.test.name).join(", "), sub: `${o.orderNo} · released ${formatDateTime(o.releasedAt, tz)}`,
          }))} />
        </Panel>
        <Panel title="Invoices to pay" action={<PanelLink href="/portal/billing" />}>
          <RowList empty="Nothing to pay." items={d.invoices.map((i) => ({
            key: i.id, title: i.invoiceNo, sub: `Issued ${formatDate(i.issuedAt, tz)} · total ${money(i.total)}`,
            right: <><span className="font-semibold tabular text-[13.5px]">{money(i.balance)}</span><StatusBadge status={i.status} /></>,
          }))} />
          {d.invoices.length > 0 && <p className="px-4 py-2.5 border-t border-border text-xs text-muted">Pay at the hospital billing counter. Online payment is not available.</p>}
        </Panel>
        <Panel title="Notifications" action={<Bell size={15} className="text-subtle" aria-hidden />}>
          <RowList empty="No notifications." items={d.notifications.map((n) => ({
            key: n.id, href: n.link?.startsWith("/portal") ? n.link : undefined, title: n.title, sub: `${n.body ? `${n.body} · ` : ""}${formatDateTime(n.createdAt, tz)}`,
            right: !n.readAt ? <span className="w-2 h-2 rounded-full bg-primary" aria-label="Unread" /> : null,
          }))} />
        </Panel>
      </div>
      <p className="mt-5 text-[13px] text-muted flex items-center gap-1.5"><FileText size={14} aria-hidden /> Looking for referral letters or reports? See <Link href="/portal/documents" className="text-primary font-semibold hover:underline">My documents</Link>.</p>
    </>
  );
}
