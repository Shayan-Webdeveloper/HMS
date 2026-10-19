import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Phone, Mail, Stethoscope, CalendarRange, CalendarCheck } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { getStaff, isHrPrivileged } from "@/lib/services/staff";
import { getStaffAttendance, listLeave } from "@/lib/services/hr";
import { getHospital } from "@/lib/services/settings";
import { formatDateOnly, formatDateTime, todayInTz, addDays } from "@/lib/utils/time";
import { ATTENDANCE_STATUS, humanize, leaveDayCount } from "@/lib/validation/staff";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { StaffStatusActions } from "@/components/staff/StaffStatusActions";
import { LeaveActions } from "@/components/staff/LeaveActions";
import { NewLeaveButton } from "@/components/staff/NewLeaveButton";

export const metadata = { title: "Staff member" };

const TONE = { PRESENT: "success", LATE: "warning", HALF_DAY: "info", ABSENT: "danger", ON_LEAVE: "primary" };
const CELL = { PRESENT: "bg-success", LATE: "bg-warning", HALF_DAY: "bg-info", ABSENT: "bg-danger", ON_LEAVE: "bg-primary" };

export default async function StaffProfilePage({ params }) {
  const session = await requirePageSession(["staff:read", "hr:read"]);
  const { id } = await params;
  const s = await getStaff(id);
  if (!s) notFound();
  const privileged = isHrPrivileged(session);
  // The general directory only lists current staff; keep former/suspended staff private to HR.
  if (!privileged && !["ACTIVE", "ON_LEAVE"].includes(s.employmentStatus)) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  const today = todayInTz(tz);
  const hrRead = can(session, "hr:read");
  const leaveVisible = can(session, ["hr:read", "staff:manage"]);
  const canManage = can(session, "staff:manage");
  const isSelf = s.id === session.staff?.id || (!!s.userId && s.userId === session.user.id);

  const [attendance, leave] = await Promise.all([
    hrRead ? getStaffAttendance(id, tz, 30) : null,
    leaveVisible ? listLeave({ staffId: id, page: 1, pageSize: 50 }) : null,
  ]);
  const name = `${s.doctorProfile ? "Dr. " : ""}${s.firstName} ${s.lastName}`;
  const user = s.user;

  return (
    <>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
          <div className="flex gap-4 min-w-0">
            <div className="w-14 h-14 rounded-full bg-secondary-soft text-secondary font-bold text-lg flex items-center justify-center shrink-0" aria-hidden>{s.firstName[0]}{s.lastName[0]}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[21px] font-bold tracking-tight">{name}</h1>
                {privileged && <StatusBadge status={s.employmentStatus} />}
                {s.doctorProfile && <Badge tone="teal" plain>Doctor</Badge>}
              </div>
              <p className="text-[13px] text-muted mt-0.5"><span className="font-mono font-semibold text-ink">{s.employeeNo}</span> · {s.position}{s.department ? <> · <Link className="hover:text-primary" href={`/staff?departmentId=${s.department.id}`}>{s.department.name}</Link></> : ""}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted">
                {s.phone && <span className="inline-flex items-center gap-1"><Phone size={13} aria-hidden />{s.phone}</span>}
                {s.email && <span className="inline-flex items-center gap-1"><Mail size={13} aria-hidden />{s.email}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.doctorProfile && <Button icon={Stethoscope} href={`/doctors/${s.doctorProfile.id}`}>Doctor profile</Button>}
            {canManage && <Button icon={Pencil} href={`/staff/${s.id}/edit`}>Edit</Button>}
          </div>
        </div>
        {canManage && (
          <div className="mt-4 pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <p className="text-[12.5px] text-muted">Employment status changes are audited. Suspending or terminating disables the login immediately.</p>
            <StaffStatusActions isSelf={isSelf} staff={{ id: s.id, name: `${s.firstName} ${s.lastName}`, employmentStatus: s.employmentStatus, hasAccount: !!s.userId }} />
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mb-5">
        <Card title="Profile">
          <dl className="dl-grid">
            <div><dt>First name</dt><dd>{s.firstName}</dd></div>
            <div><dt>Last name</dt><dd>{s.lastName}</dd></div>
            <div><dt>Email</dt><dd className="break-all">{s.email || "—"}</dd></div>
            <div><dt>Phone</dt><dd>{s.phone || "—"}</dd></div>
            <div><dt>Department</dt><dd>{s.department?.name || "—"}</dd></div>
            <div><dt>Position</dt><dd>{s.position}</dd></div>
            {privileged && <>
              <div><dt>Joining date</dt><dd>{formatDateOnly(s.joiningDate)}</dd></div>
              <div><dt>Shift</dt><dd>{s.shift ? humanize(s.shift) : "—"}</dd></div>
              <div><dt>Employment status</dt><dd><StatusBadge status={s.employmentStatus} /></dd></div>
              <div><dt>Emergency contact</dt><dd>{s.emergencyContactName || "—"}{s.emergencyContactPhone && <span className="block text-muted">{s.emergencyContactPhone}</span>}</dd></div>
            </>}
            {s.doctorProfile && <>
              <div><dt>Specialty</dt><dd>{s.doctorProfile.specialty}</dd></div>
              <div><dt>License no.</dt><dd className="font-mono">{s.doctorProfile.licenseNumber}</dd></div>
            </>}
          </dl>
        </Card>
        {privileged && (
          <Card title="Login account" description="Sign-in access linked to this staff record.">
            {!user ? (
              <p className="text-[13.5px] text-muted">No login account is linked.{s.doctorProfile && can(session, "users:manage") ? <> Create one from the <Link className="text-primary hover:underline" href={`/doctors/${s.doctorProfile.id}`}>doctor profile</Link>.</> : ""}</p>
            ) : (
              <dl className="space-y-3 text-[13.5px]">
                <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd>{user.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Sign-in email</dt><dd className="break-all text-right">{user.email}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Roles</dt><dd className="text-right">{user.roles.map((r) => r.role.name).join(", ") || "—"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Last sign-in</dt><dd>{user.lastLoginAt ? formatDateTime(user.lastLoginAt, tz) : "Never"}</dd></div>
                {user.mustChangePassword && <div className="flex justify-between gap-3"><dt className="text-muted">Password</dt><dd><Badge tone="warning" plain>Temporary — change pending</Badge></dd></div>}
                {user.lockedUntil && new Date(user.lockedUntil) > new Date() && <div className="flex justify-between gap-3"><dt className="text-muted">Lockout</dt><dd><Badge tone="danger" plain>Locked until {formatDateTime(user.lockedUntil, tz)}</Badge></dd></div>}
              </dl>
            )}
          </Card>
        )}
      </div>

      {attendance && (
        <Card title="Attendance — last 30 days" description={`${formatDateOnly(attendance.from)} – ${formatDateOnly(attendance.to)}`} className="mb-5"
          actions={can(session, "hr:manage") && <Button size="sm" variant="ghost" icon={CalendarCheck} href={`/staff?tab=attendance${s.departmentId ? `&departmentId=${s.departmentId}` : ""}`}>Record attendance</Button>}>
          <div className="flex flex-wrap gap-2 mb-4" aria-label="Attendance summary">
            {ATTENDANCE_STATUS.map((st) => <Badge key={st} tone={TONE[st]}>{humanize(st)} <span className="tabular font-bold">{attendance.summary[st]}</span></Badge>)}
            <Badge tone="neutral">Recorded days <span className="tabular font-bold">{attendance.summary.total}</span></Badge>
          </div>
          <AttendanceStrip from={attendance.from} rows={attendance.rows} />
          {attendance.rows.filter((r) => r.status !== "PRESENT" || r.note).length > 0 && (
            <div className="mt-4 -mx-[18px] -mb-[18px] border-t border-border">
              <DataTable rows={attendance.rows.filter((r) => r.status !== "PRESENT" || r.note)} caption="Attendance exceptions" columns={[
                { key: "date", label: "Date", render: (r) => formatDateOnly(r.date) },
                { key: "status", label: "Status", render: (r) => <Badge tone={TONE[r.status]}>{humanize(r.status)}</Badge> },
                { key: "note", label: "Note", render: (r) => r.note || "—" },
              ]} />
            </div>
          )}
        </Card>
      )}

      {leave && (
        <Card title="Leave history" noPadding
          actions={can(session, ["hr:manage", "staff:manage"]) && s.employmentStatus !== "TERMINATED" && <NewLeaveButton size="sm" today={today} staff={{ id: s.id, name: `${s.firstName} ${s.lastName}`, employeeNo: s.employeeNo }} />}>
          <DataTable rows={leave.rows} caption="Leave history"
            empty={<EmptyState icon={CalendarRange} title="No leave requests" description="Leave filed for this staff member will appear here." />}
            columns={[
              { key: "type", label: "Type", render: (r) => humanize(r.type) },
              { key: "dates", label: "Dates", render: (r) => <span className="tabular">{formatDateOnly(r.startDate)} – {formatDateOnly(r.endDate)} <span className="text-xs text-muted">({leaveDayCount(r.startDate, r.endDate)} d)</span></span> },
              { key: "reason", label: "Reason", render: (r) => r.reason || "—" },
              { key: "status", label: "Status", render: (r) => (
                <div className="text-left">
                  <StatusBadge status={r.status} />
                  {r.decidedByName && <p className="text-[11.5px] text-subtle mt-0.5">by {r.decidedByName}</p>}
                  {r.decisionNote && <p className="text-[11.5px] text-muted mt-0.5">“{r.decisionNote}”</p>}
                </div>
              ) },
              { key: "filed", label: "Filed", render: (r) => formatDateTime(r.createdAt, tz) },
              { key: "actions", label: "", align: "right", render: (r) => (
                <LeaveActions canDecide={can(session, "hr:manage")} canCancel={can(session, ["hr:manage", "staff:manage"])}
                  leave={{ id: r.id, status: r.status, staffName: `${s.firstName} ${s.lastName}`, isOwn: isSelf, ended: r.endDate.toISOString().slice(0, 10) < today, summary: `${humanize(r.type)} leave, ${formatDateOnly(r.startDate)} – ${formatDateOnly(r.endDate)}` }} />
              ) },
            ]} />
        </Card>
      )}
    </>
  );
}

/** 30 coloured day cells (oldest → newest). Weekly off-days and unrecorded days are grey. */
function AttendanceStrip({ from, rows }) {
  const byDate = Object.fromEntries(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  const days = Array.from({ length: 30 }, (_, i) => addDays(from, i));
  return (
    <div>
      <ol className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(18px, 1fr))" }} aria-label="Daily attendance">
        {days.map((d) => {
          const r = byDate[d];
          const label = `${formatDateOnly(d)}: ${r ? humanize(r.status) : "Not recorded"}`;
          return <li key={d} title={label} aria-label={label} className={`h-6 rounded ${r ? CELL[r.status] : "bg-neutral-soft border border-border"}`} />;
        })}
      </ol>
      <div className="flex flex-wrap gap-3 mt-2 text-[11.5px] text-muted">
        {ATTENDANCE_STATUS.map((st) => <span key={st} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${CELL[st]}`} aria-hidden />{humanize(st)}</span>)}
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-neutral-soft border border-border" aria-hidden />Not recorded</span>
      </div>
    </div>
  );
}
