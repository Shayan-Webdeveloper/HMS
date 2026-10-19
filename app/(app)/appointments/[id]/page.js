import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Phone, Stethoscope, Ticket } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getAppointment, isSuperAdmin } from "@/lib/services/appointments";
import { getHospital } from "@/lib/services/settings";
import { typeLabel, APPOINTMENT_ACTIONS } from "@/lib/validation/appointments";
import { ageFromDob, formatDateTime, formatTime, formatDate, toZonedDateString, todayInTz } from "@/lib/utils/time";
import { formatMoney } from "@/lib/utils/money";
import { serialize } from "@/lib/utils/serialize";
import { Card } from "@/components/ui/Card";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { AppointmentActions } from "@/components/appointments/AppointmentActions";

export const metadata = { title: "Appointment" };

const AUDIT_LABELS = {
  "appointment.create": "Booked", "appointment.walk_in": "Walk-in registered", "appointment.update": "Details edited", "appointment.confirm": "Confirmed",
  "appointment.check_in": "Checked in", "appointment.start": "Consultation started", "appointment.complete": "Completed", "appointment.no_show": "Marked no-show",
  "appointment.cancel": "Cancelled", "appointment.reschedule": "Rescheduled", "queue.call": "Called from queue", "vitals.create": "Vitals recorded",
};

export default async function AppointmentDetailPage({ params }) {
  const session = await requirePageSession("appointments:read");
  const { id } = await params;
  const a = await getAppointment(id);
  if (!a) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const today = todayInTz(tz);
  const showAudit = can(session, "audit:read");
  const history = await prisma.auditLog.findMany({ where: { entityType: "Appointment", entityId: a.id }, orderBy: { createdAt: "asc" }, take: 50, include: { user: { select: { name: true } } } });
  const creator = a.createdById ? await prisma.user.findUnique({ where: { id: a.createdById }, select: { name: true } }) : null;
  const isTreating = (session.doctorId && session.doctorId === a.doctorId) || isSuperAdmin(session);
  const age = ageFromDob(a.patient.dateOfBirth);
  const money = (v) => formatMoney(v, h.currency, h.locale);

  const apptProps = serialize({
    id: a.id, appointmentNo: a.appointmentNo, status: a.status, type: a.type, startsAt: a.startsAt, doctorId: a.doctorId, patientId: a.patientId,
    reason: a.reason, notes: a.notes, fee: a.fee, localDate: toZonedDateString(a.startsAt, tz),
    isToday: toZonedDateString(a.startsAt, tz) === today, isPast: a.startsAt <= new Date(),
    encounter: a.encounter ? { id: a.encounter.id, status: a.encounter.status } : null,
  });

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold tracking-tight font-mono">{a.appointmentNo}</h1>
            <StatusBadge status={a.status} />
            <Badge tone="neutral" plain>{typeLabel(a.type)}</Badge>
          </div>
          <p className="text-[13.5px] text-muted mt-1">
            {formatDate(a.startsAt, tz)} · <span className="tabular font-medium text-ink">{formatTime(a.startsAt, tz)}–{formatTime(a.endsAt, tz)}</span> · Dr. {a.doctor.staff.firstName} {a.doctor.staff.lastName} · {a.department.name}
          </p>
        </div>
        <AppointmentActions appt={apptProps} today={today} currency={h.currency}
          perms={{
            update: can(session, "appointments:update"), cancel: can(session, "appointments:cancel"), create: can(session, "appointments:create"),
            start: can(session, APPOINTMENT_ACTIONS.start.permission) && isTreating, clinical: can(session, "clinical:read"), editFee: can(session, "billing:discount"),
          }} />
      </div>

      {a.status === "CANCELLED" && a.cancelReason && (
        <div className="mb-5 rounded-lg border border-border bg-neutral-soft px-4 py-3 text-[13.5px]" role="note"><span className="font-semibold">Cancellation reason:</span> {a.cancelReason}</div>
      )}
      {a.status === "IN_PROGRESS" && a.encounter?.status === "DRAFT" && (
        <div className="mb-5 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-[13.5px] text-info" role="note">The consultation is in progress. The appointment completes automatically when the doctor finalizes the consultation.</div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5 min-w-0">
          <Card title="Appointment details">
            <dl className="dl-grid">
              <div><dt>Date</dt><dd>{formatDate(a.startsAt, tz)}</dd></div>
              <div><dt>Time</dt><dd className="tabular">{formatTime(a.startsAt, tz)} – {formatTime(a.endsAt, tz)} <span className="text-muted">({Math.round((a.endsAt - a.startsAt) / 60000)} min)</span></dd></div>
              <div><dt>Doctor</dt><dd>Dr. {a.doctor.staff.firstName} {a.doctor.staff.lastName}<span className="block text-xs text-muted">{a.doctor.specialty}</span></dd></div>
              <div><dt>Department</dt><dd>{a.department.name}</dd></div>
              <div><dt>Visit type</dt><dd>{typeLabel(a.type)}</dd></div>
              <div><dt>Consultation fee</dt><dd className="tabular">{money(a.fee)}</dd></div>
              <div><dt>Reason for visit</dt><dd>{a.reason || "—"}</dd></div>
              <div><dt>Checked in</dt><dd>{a.checkedInAt ? formatDateTime(a.checkedInAt, tz) : "—"}</dd></div>
              <div><dt>Completed</dt><dd>{a.completedAt ? formatDateTime(a.completedAt, tz) : "—"}</dd></div>
              <div><dt>Booked</dt><dd>{formatDateTime(a.createdAt, tz)}{creator && <span className="block text-xs text-muted">by {creator.name}</span>}</dd></div>
            </dl>
            {a.notes && <div className="mt-4 pt-4 border-t border-border"><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-1">Front-desk notes</p><p className="text-[13.5px] whitespace-pre-wrap">{a.notes}</p></div>}
          </Card>

          <Card title="History" description={showAudit ? "From the audit trail" : "Status changes"} noPadding>
            {history.length === 0 ? <p className="p-5 text-[13px] text-muted">No recorded activity.</p> : (
              <ol className="timeline p-5">
                {history.map((e) => (
                  <li key={e.id} className="timeline-item">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium">{AUDIT_LABELS[e.action] || e.action}</span>
                      <span className="text-xs text-subtle">{formatDateTime(e.createdAt, tz)}</span>
                    </div>
                    <p className="text-xs text-muted">
                      {e.user?.name || "System"}
                      {e.metadata?.tokenNumber ? ` · token #${e.metadata.tokenNumber}` : ""}
                      {e.action === "appointment.reschedule" && e.metadata?.from ? ` · from ${formatDateTime(e.metadata.from, tz)} to ${formatDateTime(e.metadata.to, tz)}` : ""}
                      {showAudit && e.metadata?.reason ? ` · reason: ${e.metadata.reason}` : ""}
                      {showAudit && e.metadata?.fields?.length ? ` · fields: ${e.metadata.fields.join(", ")}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Patient" actions={can(session, "patients:read") && <Link href={`/patients/${a.patient.id}`} className="text-[12.5px] font-semibold text-primary hover:underline">Open record</Link>}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-soft text-primary-ink font-bold flex items-center justify-center shrink-0" aria-hidden>{a.patient.firstName[0]}{a.patient.lastName[0]}</div>
              <div className="min-w-0">
                <p className="font-semibold">{a.patient.firstName} {a.patient.lastName}</p>
                <p className="text-[12.5px] text-muted"><span className="font-mono">{a.patient.mrn}</span> · {age != null ? `${age} y` : "Age —"} · {a.patient.sex === "UNKNOWN" ? "—" : a.patient.sex.toLowerCase()}</p>
                {a.patient.phone && <p className="text-[12.5px] text-muted inline-flex items-center gap-1 mt-1"><Phone size={12} aria-hidden />{a.patient.phone}</p>}
              </div>
            </div>
            {a.patient.medicalAlerts && can(session, "clinical:read") && (
              <p className="mt-3 rounded-md bg-warning-soft text-warning text-[12.5px] font-medium px-2.5 py-1.5 flex gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />{a.patient.medicalAlerts}</p>
            )}
            <p className="mt-3 text-[12px] text-subtle">Email updates: {a.patient.email && a.patient.consentToEmail ? "on (consented)" : "off"}</p>
          </Card>

          {a.queueEntry && (
            <Card title="Queue">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-warning-soft text-warning flex flex-col items-center justify-center"><Ticket size={14} aria-hidden /><span className="text-[18px] font-bold tabular leading-none">{a.queueEntry.tokenNumber}</span></div>
                <div>
                  <StatusBadge status={a.queueEntry.status} />
                  <p className="text-[12.5px] text-muted mt-1">Queue of {formatDate(a.queueEntry.queueDate, "UTC")}</p>
                  {(can(session, "clinical:read") || can(session, "appointments:update")) && <Link href="/consultations" className="text-[12.5px] font-semibold text-primary hover:underline">Open OPD queue</Link>}
                </div>
              </div>
            </Card>
          )}

          {a.encounter && can(session, "clinical:read") && (
            <Card title="Consultation">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2"><Stethoscope size={16} className="text-muted" aria-hidden /><Link href={`/consultations/${a.encounter.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{a.encounter.encounterNo}</Link></div>
                <StatusBadge status={a.encounter.status} />
              </div>
            </Card>
          )}

        </aside>
      </div>
    </>
  );
}
