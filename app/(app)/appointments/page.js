import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight, List, CalendarDays, CalendarRange, Calendar } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { appointmentListQuery, APPOINTMENT_STATUSES, APPOINTMENT_TYPES, typeLabel } from "@/lib/validation/appointments";
import { listAppointments, calendarAppointments, listDoctorOptions, listDepartmentOptions } from "@/lib/services/appointments";
import { getHospital } from "@/lib/services/settings";
import { dayRangeUtc, formatDate, formatDateTime, todayInTz, weekdayOf } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination, buildHref } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { cn } from "@/lib/utils/cn";
import { AppointmentCalendar } from "@/components/appointments/AppointmentCalendar";
import { WalkInButton } from "@/components/appointments/WalkInButton";
import { DateJump } from "@/components/appointments/DateJump";
import { viewRange, shiftAnchor } from "@/components/appointments/calendar-utils";

export const metadata = { title: "Appointments" };

const VIEWS = [
  { key: "list", label: "List", icon: List },
  { key: "day", label: "Day", icon: Calendar },
  { key: "week", label: "Week", icon: CalendarRange },
  { key: "month", label: "Month", icon: CalendarDays },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const statusLabel = (s) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function rangeTitle(view, first, last) {
  const d = (s) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1].slice(0, 3)}`;
  if (view === "day") return `${WD[weekdayOf(first)]}, ${d(first)} ${first.slice(0, 4)}`;
  if (view === "week") return `${d(first)} – ${d(last)} ${last.slice(0, 4)}`;
  return "";
}

export default async function AppointmentsPage({ searchParams }) {
  const session = await requirePageSession("appointments:read");
  const sp = await searchParams;
  const h = await getHospital();
  const tz = h.timezone;
  const today = todayInTz(tz);
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view : "list";
  const isDoctor = !!session.doctorId;
  const scope = isDoctor && sp.scope !== "all" ? "mine" : "all";
  const parsed = appointmentListQuery.safeParse({ ...sp, sort: sp.sort || "startsAt" });
  const q = parsed.success ? parsed.data : appointmentListQuery.parse({ sort: "startsAt" });
  const status = APPOINTMENT_STATUSES.includes(q.status) ? q.status : undefined;
  const doctorId = scope === "mine" ? session.doctorId : q.doctorId || undefined;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date || "") ? sp.date : today;
  const filters = { q: q.q, status, doctorId, departmentId: q.departmentId || undefined, type: q.type };

  const [doctors, bookable, departments] = await Promise.all([listDoctorOptions({ all: true }), listDoctorOptions(), listDepartmentOptions()]);

  // Params carried by every link on the page.
  const baseParams = { view, scope: isDoctor ? scope : undefined, q: q.q, status, doctorId: scope === "mine" ? undefined : q.doctorId, departmentId: q.departmentId, type: q.type };

  let content;
  if (view === "list") {
    const { rows, meta } = await listAppointments({ ...q, ...filters }, tz);
    const params = { ...baseParams, from: q.from, to: q.to, sort: q.sort, dir: q.dir };
    content = (
      <>
        <DataTable path="/appointments" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Appointments"
          empty={<EmptyState icon={CalendarDays} title={q.q || status || q.from || q.to ? "No appointments match these filters" : "No appointments yet"} description="Adjust the filters, or book a new appointment."
            action={can(session, "appointments:create") && <Button variant="primary" icon={CalendarPlus} href="/appointments/new">Book appointment</Button>} />}
          columns={[
            { key: "appointmentNo", label: "No.", sortable: true, render: (r) => <Link href={`/appointments/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.appointmentNo}</Link> },
            { key: "startsAt", label: "Date & time", sortable: true, render: (r) => <span className="tabular whitespace-nowrap">{formatDateTime(r.startsAt, tz)}</span> },
            { key: "patient", label: "Patient", render: (r) => <Link href={`/appointments/${r.id}`} className="font-medium hover:text-primary">{r.patient.firstName} {r.patient.lastName}<span className="block text-xs text-muted font-mono">{r.patient.mrn}</span></Link> },
            { key: "doctor", label: "Doctor", render: (r) => <span>Dr. {r.doctor.staff.firstName} {r.doctor.staff.lastName}<span className="block text-xs text-muted">{r.department.name}</span></span> },
            { key: "type", label: "Type", render: (r) => <span className="whitespace-nowrap">{typeLabel(r.type)}</span> },
            { key: "token", label: "Token", render: (r) => (r.queueEntry ? <Badge tone="warning" plain>#{r.queueEntry.tokenNumber}</Badge> : "—") },
            { key: "status", label: "Status", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        <Pagination path="/appointments" params={params} meta={meta} />
      </>
    );
  } else {
    const [first, last] = viewRange(view, anchor);
    const start = dayRangeUtc(first, tz)[0];
    const end = dayRangeUtc(last, tz)[1];
    const appts = await calendarAppointments({ start, end, ...filters }, tz);
    const days = [];
    for (let d = first; d <= last; d = shiftAnchor("day", d, 1)) days.push(d);
    const title = view === "month" ? `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}` : rangeTitle(view, first, last);
    content = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
          <div className="flex items-center gap-1.5">
            <Link className="btn btn-secondary btn-sm btn-icon" href={buildHref("/appointments", baseParams, { date: shiftAnchor(view, anchor, -1) })} aria-label="Previous"><ChevronLeft size={15} /></Link>
            <Link className="btn btn-secondary btn-sm" href={buildHref("/appointments", baseParams, { date: today })}>Today</Link>
            <Link className="btn btn-secondary btn-sm btn-icon" href={buildHref("/appointments", baseParams, { date: shiftAnchor(view, anchor, 1) })} aria-label="Next"><ChevronRight size={15} /></Link>
            <h2 className="ml-2 text-[15px] font-semibold" aria-live="polite">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted tabular">{appts.length} appointment{appts.length === 1 ? "" : "s"}{appts.length >= 1500 ? " (first 1500)" : ""}</span>
            <DateJump value={anchor} />
          </div>
        </div>
        <AppointmentCalendar view={view} anchor={anchor} days={days} appointments={appts} tz={tz} today={today} linkParams={baseParams} />
      </>
    );
  }

  const deptOptions = departments.map((d) => ({ value: d.id, label: d.name }));
  const doctorOptions = doctors.map((d) => ({ value: d.id, label: `Dr. ${d.name}` }));
  return (
    <>
      <PageHeader title="Appointments" description={`Bookings, calendar and check-in. Times shown in ${tz}.`}
        actions={can(session, "appointments:create") && (
          <>
            <WalkInButton doctors={bookable} canEditFee={can(session, "billing:discount")} currency={h.currency} defaultDoctorId={session.doctorId || undefined} redirectTo="/consultations" />
            <Button variant="primary" icon={CalendarPlus} href="/appointments/new">Book appointment</Button>
          </>
        )} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <nav className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5 shadow-sm" aria-label="View">
          {VIEWS.map((v) => (
            <Link key={v.key} href={buildHref("/appointments", { ...baseParams, date: view === "list" ? undefined : sp.date }, { view: v.key, page: undefined })} aria-current={view === v.key ? "page" : undefined}
              className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium", view === v.key ? "bg-primary text-white" : "text-muted hover:text-ink hover:bg-surface-2")}>
              <v.icon size={14} aria-hidden /><span className="hidden min-[400px]:inline">{v.label}</span>
            </Link>
          ))}
        </nav>
        {isDoctor && (
          <nav className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5 shadow-sm" aria-label="Whose appointments">
            {[{ key: "mine", label: "My appointments" }, { key: "all", label: "All doctors" }].map((s) => (
              <Link key={s.key} href={buildHref("/appointments", { ...baseParams, doctorId: undefined, date: sp.date, from: sp.from, to: sp.to }, { scope: s.key, page: undefined })} aria-current={scope === s.key ? "page" : undefined}
                className={cn("inline-flex items-center h-8 px-3 rounded-md text-[13px] font-medium", scope === s.key ? "bg-primary-soft text-primary-ink" : "text-muted hover:text-ink")}>
                {s.label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="card overflow-hidden">
        <FilterBar placeholder="Search appointment no., patient name, MRN or phone…" dateRange={view === "list"}
          filters={[
            { name: "status", label: "Status", options: APPOINTMENT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) },
            ...(scope === "mine" ? [] : [{ name: "doctorId", label: "Doctor", options: doctorOptions }]),
            { name: "departmentId", label: "Department", options: deptOptions },
            { name: "type", label: "Type", options: APPOINTMENT_TYPES.map((t) => ({ value: t, label: typeLabel(t) })) },
          ]} />
        {content}
      </div>
      {view !== "list" && <p className="text-[12px] text-subtle mt-2">Tip: click a day header to open it in day view; click any appointment for details. Today is {formatDate(new Date(), tz)}.</p>}
    </>
  );
}
