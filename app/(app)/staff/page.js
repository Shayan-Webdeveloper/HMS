import Link from "next/link";
import { UserPlus, Users, CalendarRange } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { staffListQuery, leaveListQuery, attendanceQuery, parseQuery, enumOptions, EMPLOYMENT_STATUS, LEAVE_STATUS, humanize, leaveDayCount } from "@/lib/validation/staff";
import { listStaff, listPositions, isHrPrivileged } from "@/lib/services/staff";
import { getAttendanceSheet, listLeave } from "@/lib/services/hr";
import { listDepartmentOptions } from "@/lib/services/departments";
import { getHospital } from "@/lib/services/settings";
import { formatDateOnly, formatDateTime, todayInTz } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { LinkTabs } from "@/components/ui/Tabs";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { AttendanceSheet } from "@/components/staff/AttendanceSheet";
import { LeaveActions } from "@/components/staff/LeaveActions";
import { NewLeaveButton } from "@/components/staff/NewLeaveButton";

export const metadata = { title: "Staff & HR" };

export default async function StaffPage({ searchParams }) {
  const session = await requirePageSession(["staff:read", "hr:read"]);
  const sp = await searchParams;
  const tabs = [
    { key: "directory", label: "Directory" },
    can(session, "hr:read") && { key: "attendance", label: "Attendance" },
    can(session, ["hr:read", "staff:manage"]) && { key: "leave", label: "Leave" },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab : "directory";
  const h = await getHospital();
  const today = todayInTz(h.timezone);

  return (
    <>
      <PageHeader title="Staff & HR" description="Employee directory, daily attendance and leave management."
        actions={<>
          {tab === "leave" && can(session, ["hr:manage", "staff:manage"]) && <NewLeaveButton today={today} />}
          {tab === "directory" && can(session, "staff:manage") && <Button variant="primary" icon={UserPlus} href="/staff/new">Add staff member</Button>}
        </>} />
      <div className="card">
        <LinkTabs tabs={tabs} active={tab} baseHref="/staff" />
        {tab === "directory" && <Directory sp={sp} session={session} />}
        {tab === "attendance" && <Attendance sp={sp} session={session} today={today} />}
        {tab === "leave" && <Leave sp={sp} session={session} today={today} tz={h.timezone} />}
      </div>
    </>
  );
}

async function Directory({ sp, session }) {
  const privileged = isHrPrivileged(session);
  const q = parseQuery(staffListQuery, { ...sp, sort: sp.sort || "name", dir: sp.dir || "asc" });
  const status = privileged && EMPLOYMENT_STATUS.includes(q.status) ? q.status : undefined;
  const [{ rows, meta }, departments, positions] = await Promise.all([
    listStaff({ ...q, status }, { privileged }),
    listDepartmentOptions({ includeInactive: true }),
    listPositions(),
  ]);
  const params = { tab: "directory", q: q.q, departmentId: q.departmentId, position: q.position, status, sort: q.sort, dir: q.dir };
  const filters = [
    { name: "departmentId", label: "Department", options: departments.map((d) => ({ value: d.id, label: d.name })) },
    { name: "position", label: "Position", options: positions.map((p) => ({ value: p, label: p })) },
    privileged && { name: "status", label: "Status", options: enumOptions(EMPLOYMENT_STATUS) },
  ].filter(Boolean);
  const filtered = q.q || q.departmentId || q.position || status;
  return (
    <>
      <FilterBar placeholder="Search name, employee no, email or phone…" filters={filters} />
      <DataTable path="/staff" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Staff directory"
        empty={<EmptyState icon={Users} title={filtered ? "No staff match these filters" : "No staff yet"} description={filtered ? "Try a different search or clear the filters." : "Add employees to build the directory."} />}
        columns={[
          { key: "name", label: "Name", sortable: true, render: (s) => (
            <Link href={`/staff/${s.id}`} className="block text-left group">
              <span className="block font-medium group-hover:text-primary">{s.doctorProfile ? "Dr. " : ""}{s.firstName} {s.lastName}</span>
              <span className="block text-xs text-muted">{s.email || s.phone || ""}</span>
            </Link>
          ) },
          { key: "employeeNo", label: "Emp. no", sortable: true, render: (s) => <span className="font-mono text-[12.5px]">{s.employeeNo}</span> },
          { key: "position", label: "Position", sortable: privileged, render: (s) => <>{s.position}{s.doctorProfile && <Badge tone="teal" plain className="ml-1.5">Doctor</Badge>}</> },
          { key: "department", label: "Department", render: (s) => s.department?.name || "—" },
          ...(privileged ? [
            { key: "joiningDate", label: "Joined", sortable: true, render: (s) => formatDateOnly(s.joiningDate) },
            { key: "shift", label: "Shift", render: (s) => (s.shift ? humanize(s.shift) : "—") },
            { key: "account", label: "Login", render: (s) => (!s.userId ? <span className="text-subtle text-xs">None</span> : s.user?.isActive ? <Badge tone="success" plain>Active</Badge> : <Badge tone="danger" plain>Disabled</Badge>) },
            { key: "status", label: "Status", render: (s) => <StatusBadge status={s.employmentStatus} /> },
          ] : [{ key: "phone", label: "Phone", render: (s) => s.phone || "—" }]),
        ]} />
      <Pagination path="/staff" params={params} meta={meta} />
    </>
  );
}

async function Attendance({ sp, session, today }) {
  const q = parseQuery(attendanceQuery, sp);
  const date = q.date || today;
  const [sheet, departments] = await Promise.all([
    getAttendanceSheet(date, { departmentId: q.departmentId }),
    listDepartmentOptions({ includeInactive: true }),
  ]);
  return (
    <AttendanceSheet key={`${date}:${q.departmentId || ""}`} date={date} today={today} rows={sheet.rows} canEdit={can(session, "hr:manage")}
      departments={departments.map((d) => ({ id: d.id, name: d.name }))} departmentId={q.departmentId || ""} />
  );
}

async function Leave({ sp, session, today, tz }) {
  const q = parseQuery(leaveListQuery, sp);
  const status = LEAVE_STATUS.includes(q.status) ? q.status : undefined;
  const { rows, meta } = await listLeave({ ...q, status });
  const params = { tab: "leave", q: q.q, status };
  const canDecide = can(session, "hr:manage");
  const canCancel = can(session, ["hr:manage", "staff:manage"]);
  return (
    <>
      <FilterBar placeholder="Search employee name or number…" filters={[{ name: "status", label: "Status", options: enumOptions(LEAVE_STATUS) }]} />
      <DataTable rows={rows} caption="Leave requests"
        empty={<EmptyState icon={CalendarRange} title={status || q.q ? "No leave requests match" : "No leave requests yet"} description="Requests filed for staff appear here for HR to approve or reject." />}
        columns={[
          { key: "staff", label: "Employee", render: (r) => (
            <Link href={`/staff/${r.staff.id}`} className="block text-left group">
              <span className="block font-medium group-hover:text-primary">{r.staff.firstName} {r.staff.lastName}</span>
              <span className="block text-xs text-muted"><span className="font-mono">{r.staff.employeeNo}</span>{r.staff.department ? ` · ${r.staff.department.name}` : ""}</span>
            </Link>
          ) },
          { key: "type", label: "Type", render: (r) => humanize(r.type) },
          { key: "dates", label: "Dates", render: (r) => (
            <span className="tabular">{formatDateOnly(r.startDate)} – {formatDateOnly(r.endDate)} <span className="text-xs text-muted">({leaveDayCount(r.startDate, r.endDate)} d)</span></span>
          ) },
          { key: "reason", label: "Reason", render: (r) => <span className="text-[13px] text-muted line-clamp-2 max-w-[260px] inline-block text-left">{r.reason || "—"}</span> },
          { key: "status", label: "Status", render: (r) => (
            <div className="text-left">
              <StatusBadge status={r.status} />
              {r.decidedByName && <p className="text-[11.5px] text-subtle mt-0.5">by {r.decidedByName}{r.decidedAt ? ` · ${formatDateTime(r.decidedAt, tz)}` : ""}</p>}
              {r.cancelledBy && <p className="text-[11.5px] text-subtle mt-0.5">by {r.cancelledBy}</p>}
              {r.decisionNote && <p className="text-[11.5px] text-muted mt-0.5 max-w-[220px]">“{r.decisionNote}”</p>}
            </div>
          ) },
          { key: "filed", label: "Filed", render: (r) => formatDateTime(r.createdAt, tz) },
          { key: "actions", label: "", align: "right", render: (r) => (
            <LeaveActions canDecide={canDecide} canCancel={canCancel}
              leave={{ id: r.id, status: r.status, staffName: `${r.staff.firstName} ${r.staff.lastName}`, isOwn: !!r.staff.userId && r.staff.userId === session.user.id, ended: r.endDate.toISOString().slice(0, 10) < today,
                summary: `${humanize(r.type)} leave, ${formatDateOnly(r.startDate)} – ${formatDateOnly(r.endDate)}` }} />
          ) },
        ]} />
      <Pagination path="/staff" params={params} meta={meta} />
    </>
  );
}
