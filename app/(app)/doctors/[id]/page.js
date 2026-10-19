import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Phone, Mail, IdCard, CalendarPlus, CalendarClock, CalendarDays } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getDoctor, listUpcomingExceptions, listUpcomingAppointments, isHrPrivileged, OPEN_APPOINTMENT_STATUSES } from "@/lib/services/staff";
import { getHospital } from "@/lib/services/settings";
import { formatMoney } from "@/lib/utils/money";
import { formatDateTime, formatDateOnly, todayInTz } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { REVOKING_STATUSES, humanize } from "@/lib/validation/staff";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { AvailabilityEditor } from "@/components/staff/AvailabilityEditor";
import { ScheduleExceptions } from "@/components/staff/ScheduleExceptions";
import { DoctorAccountButton } from "@/components/staff/DoctorAccountButton";

export const metadata = { title: "Doctor" };

export default async function DoctorProfilePage({ params }) {
  const session = await requirePageSession("staff:read");
  const { id } = await params;
  const d = await getDoctor(id);
  if (!d) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const canManage = can(session, "staff:manage");
  const privileged = isHrPrivileged(session);
  const canSeeAppointments = can(session, "appointments:read");
  const now = new Date();

  const [exceptions, appts, apptCount] = await Promise.all([
    listUpcomingExceptions(id, now),
    canSeeAppointments ? listUpcomingAppointments(id, { take: 25, now }) : null,
    canSeeAppointments ? null : prisma.appointment.count({ where: { doctorId: id, startsAt: { gte: now }, status: { in: OPEN_APPOINTMENT_STATUSES } } }),
  ]);

  const s = d.staff;
  const name = `Dr. ${s.firstName} ${s.lastName}`;
  const revoked = REVOKING_STATUSES.includes(s.employmentStatus);
  const bookable = s.employmentStatus === "ACTIVE" && d.acceptsAppointments && d.department.isActive;
  const account = s.user;

  return (
    <>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
          <div className="flex gap-4 min-w-0">
            <div className="w-14 h-14 rounded-full bg-primary-soft text-primary-ink font-bold text-lg flex items-center justify-center shrink-0" aria-hidden>{s.firstName[0]}{s.lastName[0]}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[21px] font-bold tracking-tight">{name}</h1>
                <StatusBadge status={s.employmentStatus} />
                {bookable ? <Badge tone="success" plain>Accepting appointments</Badge> : <Badge tone="neutral" plain>Not bookable</Badge>}
              </div>
              <p className="text-[13px] text-muted mt-0.5">
                {d.specialty} · <Link href={`/doctors?departmentId=${d.departmentId}`} className="hover:text-primary">{d.department.name}</Link> · <span className="font-mono">{s.employeeNo}</span>
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted">
                {s.phone && <span className="inline-flex items-center gap-1"><Phone size={13} aria-hidden />{s.phone}</span>}
                {s.email && <span className="inline-flex items-center gap-1"><Mail size={13} aria-hidden />{s.email}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {bookable && can(session, "appointments:create") && <Button variant="primary" icon={CalendarPlus} href={`/appointments/new?doctorId=${d.id}`}>Book appointment</Button>}
            {canManage && <Button icon={Pencil} href={`/doctors/${d.id}/edit`}>Edit</Button>}
            <Button icon={IdCard} href={`/staff/${s.id}`}>Staff record</Button>
            {!account && !revoked && can(session, "users:manage") && <DoctorAccountButton doctorId={d.id} email={s.email} />}
          </div>
        </div>
        <dl className="dl-grid mt-5 pt-4 border-t border-border">
          <div><dt>License no.</dt><dd className="font-mono">{d.licenseNumber}</dd></div>
          <div><dt>Qualifications</dt><dd>{d.qualifications || "—"}</dd></div>
          <div><dt>Consultation fee</dt><dd className="font-semibold tabular">{formatMoney(d.consultationFee, h.currency)}</dd></div>
          <div><dt>Slot length</dt><dd className="tabular">{d.slotMinutes} minutes</dd></div>
          <div><dt>Position</dt><dd>{s.position}</dd></div>
          {privileged && <div><dt>Joined</dt><dd>{formatDateOnly(s.joiningDate)}{s.shift ? ` · ${humanize(s.shift)} shift` : ""}</dd></div>}
          {privileged && (
            <div><dt>Login account</dt><dd>
              {!account ? <span className="text-muted">None</span> : (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {account.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}
                  {account.mustChangePassword && <Badge tone="warning" plain>Temp. password</Badge>}
                  <span className="text-xs text-muted">{account.lastLoginAt ? `Last sign-in ${formatDateTime(account.lastLoginAt, tz)}` : "Never signed in"}</span>
                </span>
              )}
            </dd></div>
          )}
        </dl>
        {!d.department.isActive && <p className="mt-3 text-[13px] text-warning">The {d.department.name} department is inactive — move this doctor to an active department to accept bookings.</p>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] mb-5">
        <Card title="Weekly availability" description="Recurring clinic hours used to generate bookable slots." noPadding>
          <AvailabilityEditor doctorId={d.id} canEdit={canManage} initial={d.availability.map((a) => ({ id: a.id, weekday: a.weekday, startTime: a.startTime, endTime: a.endTime }))} />
        </Card>
        <Card title="Leave & blocked time" description="Upcoming schedule exceptions override weekly hours." noPadding>
          <ScheduleExceptions doctorId={d.id} tz={tz} canEdit={canManage} today={todayInTz(tz)}
            exceptions={serialize(exceptions.map((x) => ({ id: x.id, startsAt: x.startsAt, endsAt: x.endsAt, reason: x.reason, ongoing: x.startsAt <= now })))} />
        </Card>
      </div>

      <Card title="Upcoming appointments" description={appts ? `${appts.total} booked from now on${appts.total > appts.rows.length ? ` · showing next ${appts.rows.length}` : ""}` : undefined} noPadding
        actions={appts && appts.total > 0 && <Button size="sm" variant="ghost" icon={CalendarDays} href={`/appointments?doctorId=${d.id}`}>Open in appointments</Button>}>
        {appts ? (
          <DataTable rows={appts.rows} caption="Upcoming appointments"
            empty={<EmptyState icon={CalendarClock} title="No upcoming appointments" description={bookable ? "New bookings will appear here." : "This doctor is not currently bookable."} />}
            columns={[
              { key: "when", label: "Date & time", render: (a) => <span className="tabular">{formatDateTime(a.startsAt, tz)}</span> },
              { key: "no", label: "Appointment", render: (a) => <Link className="font-mono text-[12.5px] text-primary font-semibold hover:underline" href={`/appointments/${a.id}`}>{a.appointmentNo}</Link> },
              { key: "patient", label: "Patient", render: (a) => <span>{a.patient.firstName} {a.patient.lastName} <span className="text-xs text-muted font-mono">{a.patient.mrn}</span></span> },
              { key: "type", label: "Type", render: (a) => humanize(a.type) },
              { key: "status", label: "Status", render: (a) => <StatusBadge status={a.status} /> },
            ]} />
        ) : (
          <p className="p-5 text-[13.5px] text-muted"><span className="font-semibold text-ink tabular">{apptCount}</span> upcoming booking{apptCount === 1 ? "" : "s"}. Patient details require appointment access.</p>
        )}
      </Card>
    </>
  );
}
