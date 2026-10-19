import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import { minutesFromHHMM, toZonedDateString, toZonedTimeString, weekdayOf } from "@/lib/utils/time";
import { buildHref } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { cn } from "@/lib/utils/cn";
import { STATUS_BLOCK, STATUS_DOT, assignLanes, monthGrid } from "./calendar-utils";

const PX_PER_MIN = 1.4;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEGEND = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED"];

const label = (s) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const dayLabel = (d) => `${WD[weekdayOf(d)]} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const doctorName = (a) => `Dr. ${a.doctor.staff.firstName} ${a.doctor.staff.lastName}`;

function toEvent(a, tz) {
  const date = toZonedDateString(a.startsAt, tz);
  const start = toZonedTimeString(a.startsAt, tz);
  const startMin = minutesFromHHMM(start);
  const dur = Math.max(10, Math.round((new Date(a.endsAt) - new Date(a.startsAt)) / 60000));
  return { a, date, start, startMin, endMin: startMin + dur };
}

/**
 * Custom CSS-grid calendar (server component). Views: day (one column per doctor),
 * week (one column per day) and month. Every block links to the appointment.
 */
export function AppointmentCalendar({ view, anchor, days, appointments, tz, today, linkParams }) {
  const events = appointments.map((a) => toEvent(a, tz));
  return (
    <div>
      {view === "month" ? (
        <MonthView anchor={anchor} events={events} today={today} linkParams={linkParams} />
      ) : (
        <TimeGrid view={view} days={days} events={events} today={today} linkParams={linkParams} />
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 border-t border-border text-[12px] text-muted" aria-label="Status colours">
        {LEGEND.map((s) => <span key={s} className="inline-flex items-center gap-1.5"><span className={cn("w-2.5 h-2.5 rounded-full", STATUS_DOT[s])} aria-hidden />{label(s)}</span>)}
      </div>
    </div>
  );
}

function TimeGrid({ view, days, events, today, linkParams }) {
  // Columns: one per day (week) or one per doctor (day view).
  let columns;
  if (view === "week") {
    columns = days.map((d) => ({ key: d, title: dayLabel(d), isToday: d === today, href: buildHref("/appointments", linkParams, { view: "day", date: d }), events: events.filter((e) => e.date === d) }));
  } else {
    const byDoctor = new Map();
    for (const e of events.filter((x) => x.date === days[0])) {
      const k = e.a.doctor.id;
      if (!byDoctor.has(k)) byDoctor.set(k, { key: k, title: doctorName(e.a), sub: e.a.department.name, events: [] });
      byDoctor.get(k).events.push(e);
    }
    columns = [...byDoctor.values()].sort((x, y) => x.title.localeCompare(y.title));
  }
  const all = columns.flatMap((c) => c.events);
  if (view === "day" && all.length === 0) {
    return <EmptyState icon={CalendarX2} title="No appointments on this day" description="Try another date, or clear the doctor and status filters." />;
  }
  const minStart = all.length ? Math.min(...all.map((e) => e.startMin)) : 9 * 60;
  const maxEnd = all.length ? Math.max(...all.map((e) => e.endMin)) : 17 * 60;
  const startHour = Math.min(8, Math.floor(minStart / 60));
  const endHour = Math.max(18, Math.ceil(maxEnd / 60));
  const totalMin = (endHour - startHour) * 60;
  const height = totalMin * PX_PER_MIN;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const multiDoctor = view === "week" && new Set(all.map((e) => e.a.doctor.id)).size > 1;
  const colMin = view === "week" ? 112 : 180;

  return (
    <div className="overflow-x-auto">
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(${colMin}px, 1fr))`, minWidth: 56 + columns.length * colMin }}>
        {/* Header row */}
        <div className="sticky left-0 z-20 bg-surface-2 border-b border-border" />
        {columns.map((c) => (
          <div key={c.key} className={cn("px-2 py-2 border-b border-l border-border bg-surface-2 text-center min-w-0", c.isToday && "bg-primary-soft")}>
            {c.href ? <Link href={c.href} className={cn("text-[12.5px] font-semibold hover:text-primary", c.isToday && "text-primary")}>{c.title}</Link>
              : <p className="text-[12.5px] font-semibold truncate">{c.title}</p>}
            {c.sub && <p className="text-[11px] text-muted truncate">{c.sub}</p>}
            <p className="text-[11px] text-subtle tabular">{c.events.length} appt{c.events.length === 1 ? "" : "s"}</p>
          </div>
        ))}
        {/* Hour gutter */}
        <div className="sticky left-0 z-10 bg-surface relative" style={{ height }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-subtle tabular" style={{ top: (h - startHour) * 60 * PX_PER_MIN }}>
              {h > startHour ? `${String(h).padStart(2, "0")}:00` : ""}
            </span>
          ))}
        </div>
        {columns.map((c) => (
          <div key={c.key} className={cn("relative border-l border-border", c.isToday && "bg-primary-soft/30")} style={{ height }}>
            {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-border/70" style={{ top: (h - startHour) * 60 * PX_PER_MIN }} aria-hidden />)}
            {assignLanes(c.events).map((e) => {
              const top = (e.startMin - startHour * 60) * PX_PER_MIN;
              const h = Math.max(18, (e.endMin - e.startMin) * PX_PER_MIN - 2);
              const name = `${e.a.patient.firstName} ${e.a.patient.lastName}`;
              return (
                <Link key={e.a.id} href={`/appointments/${e.a.id}`}
                  className={cn("absolute rounded-md border-l-[3px] px-1.5 py-0.5 text-[11.5px] leading-tight overflow-hidden hover:shadow-[var(--shadow-md)] hover:z-10 focus-visible:z-10", STATUS_BLOCK[e.a.status])}
                  style={{ top: top + 1, height: h, left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`, width: `calc(${100 / e.lanes}% - 4px)` }}
                  title={`${e.start} · ${name} · ${doctorName(e.a)} · ${label(e.a.status)}`}>
                  <span className="font-semibold tabular">{e.start}</span> <span className="font-medium">{name}</span>
                  {multiDoctor && <span className="block truncate opacity-80">{doctorName(e.a)}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthView({ anchor, events, today, linkParams }) {
  const days = monthGrid(anchor);
  const month = anchor.slice(0, 7);
  const byDay = new Map();
  for (const e of events) {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e);
  }
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border bg-surface-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-2 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const list = (byDay.get(d) || []).sort((x, y) => x.startMin - y.startMin);
          const inMonth = d.startsWith(month);
          const dayHref = buildHref("/appointments", linkParams, { view: "day", date: d });
          return (
            <div key={d} className={cn("min-h-[92px] sm:min-h-[118px] p-1.5 border-border min-w-0", i % 7 !== 0 && "border-l", i >= 7 && "border-t", !inMonth && "bg-surface-2/70")}>
              <div className="flex items-center justify-between gap-1">
                <Link href={dayHref} className={cn("inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-semibold tabular hover:bg-primary-soft", d === today && "bg-primary text-white hover:bg-primary-hover", !inMonth && d !== today && "text-subtle")} aria-label={`${dayLabel(d)}: ${list.length} appointments`}>
                  {Number(d.slice(8, 10))}
                </Link>
                {list.length > 0 && <span className="sm:hidden badge badge-primary badge-plain !h-5 !px-1.5 tabular">{list.length}</span>}
              </div>
              <ul className="hidden sm:block mt-1 space-y-0.5">
                {list.slice(0, 3).map((e) => (
                  <li key={e.a.id}>
                    <Link href={`/appointments/${e.a.id}`} className={cn("block truncate rounded px-1 py-px text-[11px] border-l-2", STATUS_BLOCK[e.a.status])} title={`${e.start} · ${e.a.patient.firstName} ${e.a.patient.lastName} · ${doctorName(e.a)} · ${label(e.a.status)}`}>
                      <span className="tabular font-semibold">{e.start}</span> {e.a.patient.lastName}
                    </Link>
                  </li>
                ))}
                {list.length > 3 && <li><Link href={dayHref} className="text-[11px] font-semibold text-primary hover:underline px-1">+{list.length - 3} more</Link></li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
