"use client";
import { useEffect, useState } from "react";
import { CalendarClock, RefreshCw } from "lucide-react";
import { api } from "@/components/ui/api-client";
import { Skeleton } from "@/components/ui/States";
import { cn } from "@/lib/utils/cn";

/**
 * Fetches GET /api/appointments/slots for doctor+date and renders slot buttons.
 * `refreshKey` forces a reload (e.g. after a 409 "slot taken").
 * `currentStartsAt` (ISO) marks the appointment's existing slot when rescheduling.
 */
export function SlotPicker({ doctorId, date, value, onChange, refreshKey = 0, currentStartsAt, invalid, describedBy }) {
  const [state, setState] = useState({ loading: false, error: null, data: null });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!doctorId || !date) { setState({ loading: false, error: null, data: null }); return; }
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api(`/api/appointments/slots?doctorId=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(date)}`, { signal: ctl.signal })
      .then((r) => setState({ loading: false, error: null, data: r.data }))
      .catch((e) => { if (e.name !== "AbortError") setState({ loading: false, error: e.message || "Could not load slots", data: null }); });
    return () => ctl.abort();
  }, [doctorId, date, refreshKey, reload]);

  // Drop a selection that is no longer offered as available.
  useEffect(() => {
    if (value && state.data && !state.data.slots.some((s) => s.start === value && s.available)) onChange(null);
  }, [state.data, value, onChange]);

  if (!doctorId || !date) {
    return <p className="text-[13px] text-muted flex items-center gap-2 py-3"><CalendarClock size={15} aria-hidden /> Choose a doctor and date to see available times.</p>;
  }
  if (state.loading && !state.data) {
    return <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 py-1" aria-busy="true" aria-label="Loading slots">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>;
  }
  if (state.error) {
    return (
      <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger flex items-center justify-between gap-2">
        <span>{state.error}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReload((n) => n + 1)}><RefreshCw size={13} /> Retry</button>
      </div>
    );
  }
  const slots = state.data?.slots || [];
  const free = slots.filter((s) => s.available).length;
  return (
    <div aria-describedby={describedBy}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[12.5px] text-muted">
          {slots.length ? <><span className="font-semibold text-ink tabular">{free}</span> of {slots.length} slots free · {state.data.slotMinutes} min each</> : (state.data?.message || "No slots")}
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReload((n) => n + 1)} aria-label="Refresh slots" disabled={state.loading}>
          <RefreshCw size={13} className={state.loading ? "animate-spin" : ""} aria-hidden /> Refresh
        </button>
      </div>
      {slots.length > 0 && free === 0 && state.data?.message && <p className="text-[13px] text-warning mb-2">{state.data.message}</p>}
      {slots.length > 0 && (
        <div role="radiogroup" aria-label="Available times" aria-invalid={invalid || undefined} className="grid grid-cols-3 min-[420px]:grid-cols-4 sm:grid-cols-6 gap-2">
          {slots.map((s) => {
            const selected = value === s.start;
            const isCurrent = currentStartsAt && new Date(currentStartsAt).getTime() === new Date(s.startsAt).getTime();
            return (
              <button key={s.start} type="button" role="radio" aria-checked={selected} disabled={!s.available}
                title={!s.available ? (isCurrent ? "Current time" : s.reason === "unavailable" ? "Doctor unavailable" : "Booked") : `Book ${s.start}`}
                onClick={() => onChange(s.start)}
                className={cn(
                  "h-9 rounded-md border text-[13px] font-semibold tabular transition-colors",
                  selected ? "bg-primary text-white border-primary shadow-sm" : s.available ? "bg-surface border-border-strong hover:border-primary hover:text-primary" : "bg-surface-2 border-border text-subtle line-through cursor-not-allowed",
                  isCurrent && "ring-2 ring-warning/50 no-underline",
                )}>
                {s.start}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
