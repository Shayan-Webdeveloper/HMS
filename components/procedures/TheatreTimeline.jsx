import Link from "next/link";
import { timelineBlock } from "@/lib/validation/procedures";
import { minutesFromHHMM, toZonedTimeString, toZonedDateString } from "@/lib/utils/time";

const TONE = {
  SCHEDULED: "bg-primary-soft border-primary/40 text-primary-ink",
  IN_PROGRESS: "bg-info-soft border-info/50 text-info",
  COMPLETED: "bg-success-soft border-success/40 text-success",
  CANCELLED: "bg-neutral-soft border-border-strong text-muted line-through",
};

/** Per-theatre horizontal day timeline (server component). */
export function TheatreTimeline({ date, theatres, procedures, tz }) {
  const mins = (d) => {
    // minutes from local midnight of `date`; clamp procedures spanning midnight
    const day = toZonedDateString(d, tz);
    if (day < date) return 0;
    if (day > date) return 24 * 60;
    return minutesFromHHMM(toZonedTimeString(d, tz));
  };
  const spans = procedures.map((p) => [mins(p.scheduledStart), mins(p.scheduledEnd)]);
  const start = Math.min(7 * 60, ...spans.map((s) => Math.floor(s[0] / 60) * 60));
  const end = Math.max(20 * 60, ...spans.map((s) => Math.ceil(s[1] / 60) * 60));
  const hours = [];
  for (let m = start; m <= end; m += 60) hours.push(m);
  const rows = theatres.filter((t) => t.isActive || procedures.some((p) => p.theatreId === t.id));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] p-4">
        <div className="grid grid-cols-[110px_1fr] items-end mb-1">
          <span />
          <div className="relative h-5">
            {hours.map((m) => (
              <span key={m} className="absolute -translate-x-1/2 text-[11px] text-subtle tabular" style={{ left: `${((m - start) / (end - start)) * 100}%` }}>{String(m / 60).padStart(2, "0")}:00</span>
            ))}
          </div>
        </div>
        {rows.length === 0 && <p className="text-[13px] text-muted py-6 text-center">No theatres configured.</p>}
        {rows.map((t) => {
          const items = procedures.filter((p) => p.theatreId === t.id);
          return (
            <div key={t.id} className="grid grid-cols-[110px_1fr] items-stretch border-t border-border">
              <div className="py-3 pr-2 text-[13px] font-semibold">{t.name}{!t.isActive && <span className="block text-[11px] text-muted font-normal">inactive</span>}</div>
              <div className="relative h-[64px] bg-surface-2">
                {hours.map((m) => <span key={m} className="absolute top-0 bottom-0 border-l border-border" style={{ left: `${((m - start) / (end - start)) * 100}%` }} aria-hidden />)}
                {items.map((p) => {
                  const b = timelineBlock(mins(p.scheduledStart), mins(p.scheduledEnd), start, end);
                  return (
                    <Link key={p.id} href={`/procedures/${p.id}`} title={`${p.procedureNo} · ${p.name} · ${p.patient.firstName} ${p.patient.lastName} · ${toZonedTimeString(p.scheduledStart, tz)}–${toZonedTimeString(p.scheduledEnd, tz)}`}
                      className={`absolute top-1.5 bottom-1.5 rounded-md border px-2 py-1 overflow-hidden text-[11.5px] leading-tight hover:shadow-[var(--shadow-md)] ${TONE[p.status] || TONE.SCHEDULED}`}
                      style={{ left: `${b.left}%`, width: `${b.width}%` }}>
                      <span className="block font-semibold truncate">{toZonedTimeString(p.scheduledStart, tz)} {p.name}</span>
                      <span className="block truncate opacity-80">{p.patient.lastName} · {p.surgeon.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
