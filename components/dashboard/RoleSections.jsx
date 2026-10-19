import Link from "next/link";
import {
  CalendarDays, Clock, Users, BedDouble, FlaskConical, Stethoscope, CalendarClock, FileWarning, UserPlus, CalendarPlus, Footprints, LogIn,
  Inbox, HeartPulse, Syringe, Siren, TestTube, Timer, AlertTriangle, ScanLine, CheckCircle2, Pill, PackageMinus, CalendarX2, Wallet, Receipt, Undo2, FileText,
} from "lucide-react";
import { can } from "@/lib/auth/session";
import { loadDoctor, loadReception, loadNursing, loadLaboratory, loadRadiology, loadPharmacy, loadBilling, computeTrend } from "@/lib/services/dashboard";
import { formatMoney } from "@/lib/utils/money";
import { formatDateTime, formatTime, formatDate, formatDateOnly } from "@/lib/utils/time";
import { MetricCard } from "@/components/ui/MetricCard";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { CHART_COLORS } from "@/components/charts/theme";
import { KpiGrid, Panel, PanelLink, RowList, StatRows, QuickActions, fmtInt, patientName, doctorName } from "./Widgets";

const pLink = (session, p) => (can(session, "patients:read") ? `/patients/${p.id}` : undefined);

// ───────────────────────────── Doctor ─────────────────────────────

export async function DoctorSection({ session, ctx }) {
  const d = await loadDoctor(session.doctorId, ctx);
  const tz = ctx.tz;
  const remaining = d.schedule.filter((a) => !["COMPLETED", "NO_SHOW"].includes(a.status)).length;
  const incomplete = [
    ...d.staleDrafts.map((e) => ({ key: e.id, href: `/consultations/${e.id}`, title: `${patientName(e.patient)} — ${e.encounterNo}`, sub: `Draft since ${formatDateTime(e.startedAt, tz)}`, right: <StatusBadge status="DRAFT" /> })),
    ...d.staleInProgress.map((a) => ({ key: a.id, href: `/appointments/${a.id}`, title: `${patientName(a.patient)} — ${a.appointmentNo}`, sub: `Visit still open from ${formatDateTime(a.startsAt, tz)}`, right: <StatusBadge status="IN_PROGRESS" /> })),
  ];
  return (
    <div className="space-y-5">
      <KpiGrid>
        <MetricCard label="Today's patients" value={fmtInt(d.schedule.length)} icon={CalendarDays} hint={`${fmtInt(remaining)} still to be seen`} href="/consultations" />
        <MetricCard label="Waiting now" value={fmtInt(d.waiting)} icon={Clock} tone={d.waiting ? "warning" : "success"} hint="checked in, in your queue" href="/consultations" />
        <MetricCard label="Patients under care" value={fmtInt(d.underCare.length)} icon={BedDouble} tone="primary" hint="admitted under you" href="/admissions" />
        <MetricCard label="Consultations signed" value={fmtInt(d.consults)} icon={Stethoscope} tone="teal" trend={computeTrend(d.consults, d.consultsPrev)} />
        <MetricCard label="Pending lab results" value={fmtInt(d.pendingLabCount)} icon={FlaskConical} tone="info" hint="your orders not yet released" href="/laboratory" />
        <MetricCard label="Upcoming (7 days)" value={fmtInt(d.upcomingCount)} icon={CalendarClock} tone="info" href="/appointments" />
        <MetricCard label="Follow-ups due (7 days)" value={fmtInt(d.followUps.length)} icon={CalendarPlus} tone="teal" />
        <MetricCard label="Incomplete documentation" value={fmtInt(incomplete.length)} icon={FileWarning} tone={incomplete.length ? "danger" : "success"} hint="drafts / open visits before today" />
      </KpiGrid>
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Today's schedule" className="lg:col-span-2" action={<PanelLink href="/consultations">Open clinic</PanelLink>}>
          <RowList empty="No appointments today." items={d.schedule.map((a) => ({
            key: a.id, href: `/appointments/${a.id}`, title: `${formatTime(a.startsAt, tz)} · ${patientName(a.patient)}`,
            sub: `${a.patient.mrn} · ${a.type.replace("_", " ").toLowerCase()}${a.queueEntry ? ` · token ${a.queueEntry.tokenNumber}` : ""}`,
            right: <StatusBadge status={a.queueEntry?.status === "WAITING" ? "WAITING" : a.status} />,
          }))} />
        </Panel>
        <Panel title="Incomplete documentation" description="Sign or close these records">
          <RowList empty="All caught up — no stale drafts." items={incomplete} />
        </Panel>
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Patients under your care" action={<PanelLink href="/admissions" />}>
          <RowList empty="No admitted patients." items={d.underCare.map((a) => {
            const bed = a.bedAssignments[0]?.bed;
            return { key: a.id, href: `/admissions/${a.id}`, title: patientName(a.patient), sub: `${bed ? `${bed.ward.name} · ${bed.label}` : "No bed"} · since ${formatDate(a.admittedAt, tz)}` };
          })} />
        </Panel>
        <Panel title="Pending lab results" action={<PanelLink href="/laboratory" />}>
          <RowList empty="No pending orders." items={d.pendingLabs.map((o) => ({
            key: o.id, href: `/laboratory/${o.id}`, title: `${patientName(o.patient)} — ${o.orderNo}`, sub: `${o._count.items} test${o._count.items === 1 ? "" : "s"} · ordered ${formatDateTime(o.createdAt, tz)}`,
            right: <>{o.priority !== "ROUTINE" && <StatusBadge status={o.priority} />}<StatusBadge status={o.status} /></>,
          }))} />
        </Panel>
        <Panel title="Upcoming appointments" description="Next 7 days" action={<PanelLink href="/appointments" />}>
          <RowList empty="Nothing booked." items={d.upcoming.map((a) => ({ key: a.id, href: `/appointments/${a.id}`, title: patientName(a.patient), sub: formatDateTime(a.startsAt, tz), right: <StatusBadge status={a.status} /> }))} />
        </Panel>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Follow-up reminders" description="Follow-up dates in the next 7 days">
          <RowList empty="No follow-ups due." items={d.followUps.map((e) => ({ key: e.id, href: pLink(session, e.patient), title: patientName(e.patient), sub: `${e.patient.mrn} · from ${e.encounterNo}`, right: <span className="text-xs font-semibold">{formatDateOnly(e.followUpDate)}</span> }))} />
        </Panel>
        <Panel title="Recent consultations">
          <RowList empty="No signed consultations yet." items={d.recent.map((e) => ({
            key: e.id, href: `/consultations/${e.id}`, title: patientName(e.patient),
            sub: `${formatDateTime(e.finalizedAt, tz)}${e.diagnoses[0] ? ` · ${e.diagnoses[0].code ? e.diagnoses[0].code + " " : ""}${e.diagnoses[0].description}` : ""}`,
          }))} />
        </Panel>
      </div>
    </div>
  );
}

// ───────────────────────────── Front desk ─────────────────────────────

const APPT_ORDER = ["REQUESTED", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED"];

export async function ReceptionSection({ session, ctx }) {
  const d = await loadReception(ctx);
  const tz = ctx.tz;
  const total = Object.entries(d.byStatus).filter(([s]) => s !== "CANCELLED").reduce((n, [, v]) => n + v, 0);
  const actions = [
    can(session, "patients:create") && { href: "/patients/new", label: "Register patient", icon: UserPlus },
    can(session, "appointments:create") && { href: "/appointments/new", label: "Book appointment", icon: CalendarPlus },
    can(session, "appointments:read") && { href: "/appointments?status=REQUESTED", label: "Portal requests", icon: Inbox },
    can(session, "emergency:manage") && { href: "/emergency", label: "Emergency desk", icon: Siren },
  ].filter(Boolean);
  return (
    <div className="space-y-5">
      <KpiGrid>
        <MetricCard label="Today's appointments" value={fmtInt(total)} icon={CalendarDays} hint={`${fmtInt(d.byStatus.CANCELLED || 0)} cancelled`} href="/appointments" />
        <MetricCard label="Checked in today" value={fmtInt(d.checkIns)} icon={LogIn} tone="teal" />
        <MetricCard label="Waiting in queue" value={fmtInt(d.waitingCount)} icon={Clock} tone={d.waitingCount ? "warning" : "success"} href="/consultations" />
        <MetricCard label="Walk-ins today" value={fmtInt(d.walkIns)} icon={Footprints} tone="info" />
        <MetricCard label="Portal requests to confirm" value={fmtInt(d.requests)} icon={Inbox} tone={d.requests ? "warning" : "success"} href="/appointments?status=REQUESTED" />
        <MetricCard label="New registrations" value={fmtInt(d.registered)} icon={UserPlus} tone="teal" trend={computeTrend(d.registered, d.registeredPrev)} />
        <MetricCard label="Appointments booked" value={fmtInt(d.booked)} icon={CalendarPlus} tone="primary" trend={computeTrend(d.booked, d.bookedPrev)} hint="by booking date" />
        <MetricCard label="Doctors in clinic today" value={fmtInt(d.availability.length)} icon={Users} tone="info" />
      </KpiGrid>
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Today by status">
          <StatRows rows={APPT_ORDER.filter((s) => d.byStatus[s]).map((s) => ({ label: s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), value: fmtInt(d.byStatus[s]), href: `/appointments?status=${s}` }))} />
          {!Object.keys(d.byStatus).length && <p className="px-4 py-8 text-center text-[13px] text-muted">No appointments today.</p>}
        </Panel>
        <Panel title="Waiting queue" action={<PanelLink href="/consultations">Queue</PanelLink>}>
          <RowList empty="Nobody is waiting." items={d.queue.map((q) => ({
            key: q.id, href: `/appointments/${q.appointment.id}`, title: `#${q.tokenNumber} · ${patientName(q.appointment.patient)}`,
            sub: `${doctorName(q.appointment.doctor)} · ${formatTime(q.appointment.startsAt, tz)}`, right: <StatusBadge status={q.status} />,
          }))} />
        </Panel>
        <Panel title="Quick actions"><QuickActions actions={actions} /></Panel>
      </div>
      <Panel title="Doctor availability today" description="Remaining free slots = availability windows − booked appointments − schedule exceptions − slots already past">
        {d.availability.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-muted">No doctors hold clinic today.</p> : (
          <div className="table-wrap">
            <table className="table table-responsive">
              <thead><tr><th>Doctor</th><th>Department</th><th>Hours</th><th className="num">Booked</th><th className="num">Free slots</th><th>Status</th></tr></thead>
              <tbody>
                {d.availability.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Doctor" className="font-medium">{a.name}</td>
                    <td data-label="Department">{a.department}</td>
                    <td data-label="Hours" className="tabular">{a.windows}</td>
                    <td data-label="Booked" className="num">{a.booked}</td>
                    <td data-label="Free slots" className="num font-semibold">{a.free} <span className="text-subtle font-normal">/ {a.total}</span></td>
                    <td data-label="Status">{a.hasException ? <Badge tone="warning">Schedule exception</Badge> : a.free > 0 ? <Badge tone="success">Available</Badge> : <Badge tone="neutral">Fully booked</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ───────────────────────────── Nursing ─────────────────────────────

export async function NursingSection({ session, ctx }) {
  const d = await loadNursing(session, ctx);
  return (
    <div className="space-y-5">
      <KpiGrid>
        <MetricCard label="Admitted patients" value={fmtInt(d.admitted)} icon={BedDouble} href="/admissions" />
        <MetricCard label="Vitals recorded today" value={fmtInt(d.vitalsToday)} icon={HeartPulse} tone="teal" hint={`${fmtInt(d.vitalsMine)} by you`} />
        <MetricCard label="Medication rounds today" value={fmtInt(d.medsToday)} icon={Syringe} tone="info" hint="administrations recorded" />
        <MetricCard label="No vitals in 8 hours" value={fmtInt(d.dueObsCount)} icon={Clock} tone={d.dueObsCount ? "warning" : "success"} hint="admitted patients" />
        {d.waitingTriage != null && <MetricCard label="ER awaiting triage" value={fmtInt(d.waitingTriage)} icon={Siren} tone={d.waitingTriage ? "danger" : "success"} href="/emergency" />}
      </KpiGrid>
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Current admissions per ward" className="lg:col-span-2" action={<PanelLink href="/wards">Wards</PanelLink>}>
          {d.wards.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-muted">No active wards.</p> : (
            <div className="table-wrap">
              <table className="table table-responsive">
                <thead><tr><th>Ward</th><th className="num">Admitted</th><th className="num">Available</th><th className="num">Cleaning</th><th className="num">Out of service</th><th>Occupancy</th></tr></thead>
                <tbody>
                  {d.wards.map((w) => {
                    const inService = w.total - w.outOfService;
                    const pct = inService ? Math.round((w.occupied / inService) * 100) : 0;
                    return (
                      <tr key={w.id}>
                        <td data-label="Ward" className="font-medium">{w.name}</td>
                        <td data-label="Admitted" className="num font-semibold">{w.occupied}</td>
                        <td data-label="Available" className="num">{w.available}</td>
                        <td data-label="Cleaning" className="num">{w.cleaning}</td>
                        <td data-label="Out of service" className="num">{w.outOfService}</td>
                        <td data-label="Occupancy">
                          <div className="flex items-center gap-2 justify-end sm:justify-start">
                            <div className="w-24 h-1.5 rounded-full bg-neutral-soft overflow-hidden" aria-hidden><div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? CHART_COLORS.red : CHART_COLORS.primary }} /></div>
                            <span className="text-xs tabular text-muted">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Observations due" description="Admitted patients with no vitals recorded in the last 8 hours">
          <RowList empty="Every admitted patient has recent vitals." items={d.dueObs.map((a) => {
            const bed = a.bedAssignments[0]?.bed;
            return { key: a.id, href: `/admissions/${a.id}`, title: patientName(a.patient), sub: bed ? `${bed.ward.name} · ${bed.label}` : a.admissionNo };
          })} />
        </Panel>
      </div>
    </div>
  );
}

// ───────────────────────────── Laboratory ─────────────────────────────

export async function LaboratorySection({ ctx }) {
  const d = await loadLaboratory(ctx);
  const s = d.byStatus;
  return (
    <div className="space-y-5">
      <KpiGrid>
        <MetricCard label="Awaiting collection" value={fmtInt(s.REQUESTED || 0)} icon={TestTube} tone="info" href="/laboratory?status=REQUESTED" />
        <MetricCard label="In process" value={fmtInt((s.SAMPLE_COLLECTED || 0) + (s.PROCESSING || 0))} icon={FlaskConical} tone="primary" hint="collected or processing" href="/laboratory?status=PROCESSING" />
        <MetricCard label="Awaiting validation" value={fmtInt(s.AWAITING_VALIDATION || 0)} icon={CheckCircle2} tone="warning" href="/laboratory?status=AWAITING_VALIDATION" />
        <MetricCard label="Past turnaround target" value={fmtInt(d.overdue)} icon={AlertTriangle} tone={d.overdue ? "danger" : "success"} hint="pending orders" />
        <MetricCard label="Orders released" value={fmtInt(d.released)} icon={CheckCircle2} tone="success" trend={computeTrend(d.released, d.releasedPrev)} />
        <MetricCard label="Average turnaround" value={d.avgTatHours == null ? "—" : `${d.avgTatHours} h`} icon={Timer} tone="teal" hint="order → release, released in period" />
        <MetricCard label="Rejected specimens" value={fmtInt(d.rejected)} icon={FileWarning} tone={d.rejected ? "warning" : "success"} />
      </KpiGrid>
      <Panel title="STAT & urgent queue" description="Oldest first" action={<PanelLink href="/laboratory" />}>
        <RowList empty="No STAT or urgent orders pending." items={d.urgent.map((o) => ({
          key: o.id, href: `/laboratory/${o.id}`, title: `${o.orderNo} · ${patientName(o.patient)}`, sub: `${o._count.items} test${o._count.items === 1 ? "" : "s"} · ordered ${formatDateTime(o.createdAt, ctx.tz)}`,
          right: <><StatusBadge status={o.priority} /><StatusBadge status={o.status} /></>,
        }))} />
      </Panel>
    </div>
  );
}

// ───────────────────────────── Radiology ─────────────────────────────

export async function RadiologySection({ ctx }) {
  const d = await loadRadiology(ctx);
  const s = d.byStatus;
  return (
    <div className="space-y-5">
      <KpiGrid>
        <MetricCard label="Requested" value={fmtInt(s.REQUESTED || 0)} icon={ScanLine} tone="info" href="/radiology?status=REQUESTED" />
        <MetricCard label="Scheduled / in progress" value={fmtInt((s.SCHEDULED || 0) + (s.IN_PROGRESS || 0))} icon={CalendarClock} tone="primary" href="/radiology?status=SCHEDULED" />
        <MetricCard label="Awaiting verification" value={fmtInt(s.REPORTED || 0)} icon={FileText} tone="warning" href="/radiology?status=REPORTED" />
        <MetricCard label="Reports verified" value={fmtInt(d.verified)} icon={CheckCircle2} tone="success" trend={computeTrend(d.verified, d.verifiedPrev)} />
      </KpiGrid>
      <Panel title="Worklist" description="Open studies, oldest first" action={<PanelLink href="/radiology" />}>
        <RowList empty="No open studies." items={d.queue.map((x) => ({
          key: x.id, href: `/radiology/${x.id}`, title: `${x.studyNo} · ${x.modality} ${x.bodyPart}`, sub: `${patientName(x.patient)} · ${x.scheduledAt ? `scheduled ${formatDateTime(x.scheduledAt, ctx.tz)}` : `requested ${formatDateTime(x.createdAt, ctx.tz)}`}`,
          right: <StatusBadge status={x.status} />,
        }))} />
      </Panel>
    </div>
  );
}

// ───────────────────────────── Pharmacy ─────────────────────────────

export async function PharmacySection({ ctx }) {
  const d = await loadPharmacy(ctx);
  const money = (v) => formatMoney(v, ctx.currency, ctx.locale);
  return (
    <div className="space-y-5">
      <KpiGrid>
        <MetricCard label="Prescriptions to dispense" value={fmtInt(d.pendingCount)} icon={Pill} tone={d.pendingCount ? "warning" : "success"} href="/pharmacy" />
        <MetricCard label="Units dispensed" value={fmtInt(d.dispensedUnits)} icon={PackageMinus} tone="primary" trend={computeTrend(d.dispensedUnits, d.dispensedUnitsPrev)} />
        <MetricCard label="Dispensed value" value={money(d.dispensedValue)} icon={Wallet} tone="teal" hint={`${fmtInt(d.dispenseCount)} dispense lines · at current price`} />
        <MetricCard label="Low-stock medicines" value={fmtInt(d.lowStock.length)} icon={AlertTriangle} tone={d.lowStock.length ? "danger" : "success"} href="/pharmacy?tab=stock&status=low" />
        <MetricCard label={`Expiring ≤ ${d.expiryDays} days`} value={fmtInt(d.expiring.count)} icon={CalendarX2} tone={d.expiring.count ? "warning" : "success"} hint="batches with stock" href="/pharmacy?tab=stock&status=expiring" />
        <MetricCard label="Expired, still in stock" value={fmtInt(d.expired)} icon={FileWarning} tone={d.expired ? "danger" : "success"} hint="remove from shelves" />
      </KpiGrid>
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Awaiting dispensing" description="Oldest first" action={<PanelLink href="/pharmacy" />}>
          <RowList empty="No prescriptions waiting." items={d.pending.map((r) => ({
            key: r.id, href: `/pharmacy/prescriptions/${r.id}`, title: `${r.prescriptionNo} · ${patientName(r.patient)}`, sub: `${r._count.items} item${r._count.items === 1 ? "" : "s"} · ${formatDateTime(r.issuedAt || r.createdAt, ctx.tz)}`, right: <StatusBadge status={r.status} />,
          }))} />
        </Panel>
        <Panel title="Low stock" description="On hand ≤ reorder level" action={<PanelLink href="/reports/medicine-stock?status=LOW">Stock report</PanelLink>}>
          <RowList empty="All medicines are above reorder level." items={d.lowStock.slice(0, 8).map((m) => ({
            key: m.id, title: `${m.genericName} ${m.strength}`, sub: m.brandName || m.code, right: <span className="text-[13px]"><span className="font-semibold text-danger tabular">{m.onHand}</span><span className="text-subtle"> / {m.reorderLevel}</span></span>,
          }))} />
        </Panel>
        <Panel title="Expiring soon" action={<PanelLink href="/reports/expiry">Expiry report</PanelLink>}>
          <RowList empty={`No batches expire within ${d.expiryDays} days.`} items={d.expiring.rows.map((b) => ({
            key: b.id, title: `${b.medication.genericName} ${b.medication.strength}`, sub: `Batch ${b.batchNo} · ${b.quantity} units`, right: <span className="text-xs font-semibold text-warning">{formatDateOnly(b.expiryDate)}</span>,
          }))} />
        </Panel>
      </div>
    </div>
  );
}

// ───────────────────────────── Billing ─────────────────────────────

export async function BillingSection({ ctx }) {
  const d = await loadBilling(ctx);
  const money = (v) => formatMoney(v, ctx.currency, ctx.locale);
  return (
    <div className="space-y-5">
      <KpiGrid>
        <MetricCard label="Collected today" value={money(d.today.net)} icon={Wallet} tone="success" hint={`${fmtInt(d.today.paymentCount)} payments`} />
        <MetricCard label="Net collected" value={money(d.period.net)} icon={Receipt} tone="teal" trend={computeTrend(d.period.net, d.prev.net)} hint="payments − refunds" />
        <MetricCard label="Refunds" value={money(d.period.refunds)} icon={Undo2} tone="warning" hint={`${fmtInt(d.period.refundCount)} in period`} />
        <MetricCard label="Outstanding balance" value={money(d.outstandingBalance)} icon={FileWarning} tone="danger" hint={`${fmtInt(d.outstandingCount)} invoices`} href="/billing" />
      </KpiGrid>
      <div className="grid lg:grid-cols-3 gap-5">
        <Panel title="Collections per day" description="Payments received minus refunds" className="lg:col-span-2" bodyClassName="p-4">
          <TimeSeriesChart data={d.daily} series={[{ key: "net", label: "Net collected", color: "teal" }]} yLabel="Amount" money currency={ctx.currency} locale={ctx.locale} ariaLabel="Net collections per day" />
        </Panel>
        <Panel title="By payment method" description="Payments in period">
          {d.byMethod.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-muted">No payments in this period.</p>
            : <StatRows rows={d.byMethod.map((m) => ({ label: `${m.method.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} (${m.count})`, value: money(m.amount) }))} />}
          <div className="px-4 py-3 border-t border-border text-xs text-muted">{fmtInt(d.drafts)} draft invoice{d.drafts === 1 ? "" : "s"} awaiting issue · <Link href="/billing" className="text-primary font-semibold hover:underline">Billing</Link></div>
        </Panel>
      </div>
      <Panel title="Recent payments" action={<PanelLink href="/billing" />}>
        <RowList empty="No payments recorded yet." items={d.recent.map((p) => ({
          key: p.id, href: `/billing/${p.invoice.id}`, title: `${p.receiptNo} · ${patientName(p.invoice.patient)}`, sub: `${p.invoice.invoiceNo} · ${formatDateTime(p.receivedAt, ctx.tz)}`,
          right: <><Badge tone="neutral" plain>{p.method.replace("_", " ").toLowerCase()}</Badge><span className="font-semibold tabular text-[13.5px]">{money(p.amount)}</span></>,
        }))} />
      </Panel>
    </div>
  );
}
