"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Loader2 } from "lucide-react";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "custom", label: "Custom" },
];

/**
 * URL-synchronised period picker: ?range=today|7d|30d|90d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD.
 * `period` is the server-resolved period (so the UI always reflects what was actually queried).
 */
export function PeriodFilter({ period, maxDays = 366 }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState(period.key === "custom");
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [error, setError] = useState("");

  function go(params) {
    const next = new URLSearchParams(sp.toString());
    for (const k of ["range", "from", "to"]) next.delete(k);
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function choose(key) {
    setError("");
    if (key === "custom") { setCustom(true); return; }
    setCustom(false);
    go({ range: key });
  }

  function applyCustom(e) {
    e.preventDefault();
    if (!from || !to) { setError("Choose both dates."); return; }
    if (from > to) { setError("The start date must be on or before the end date."); return; }
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (span > maxDays) { setError(`Choose at most ${maxDays} days.`); return; }
    setError("");
    go({ range: "custom", from, to });
  }

  const active = custom ? "custom" : period.key;
  return (
    <div className="flex flex-col gap-2 no-print">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Reporting period" className="inline-flex rounded-lg border border-border-strong bg-surface p-0.5 shadow-[var(--shadow-sm)]">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => choose(p.key)} aria-pressed={active === p.key}
              className={`px-3 h-8 rounded-md text-[12.5px] font-semibold transition-colors ${active === p.key ? "bg-primary text-white" : "text-muted hover:text-ink hover:bg-surface-2"}`}>
              {p.label}
            </button>
          ))}
        </div>
        {pending && <Loader2 size={15} className="animate-spin text-subtle" aria-label="Loading" />}
      </div>
      {custom && (
        <form onSubmit={applyCustom} className="flex flex-wrap items-end gap-2" noValidate>
          <div>
            <label htmlFor="period-from" className="field-label">From</label>
            <input id="period-from" type="date" className="input w-[160px]" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-invalid={!!error || undefined} />
          </div>
          <div>
            <label htmlFor="period-to" className="field-label">To</label>
            <input id="period-to" type="date" className="input w-[160px]" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={!!error || undefined} />
          </div>
          <button type="submit" className="btn btn-primary"><CalendarRange size={15} aria-hidden /> Apply</button>
          {error && <p className="field-error w-full" role="alert">{error}</p>}
        </form>
      )}
      <p className="text-xs text-muted">
        <span className="font-semibold text-ink">{period.rangeLabel}</span>
        <span className="text-subtle"> · compared with {period.prevLabel}</span>
      </p>
    </div>
  );
}
