"use client";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";

function shift(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * URL-synchronised report filters. Only the filters the report declares are shown.
 * `value` holds the server-resolved filter values (defaults already applied).
 */
export function ReportFilters({ filters, value, today, statusLabel = "Status", statusOptions = [], departments = [], doctors = [], defaultStatus = "" }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const uses = (k) => filters.includes(k);

  function push(updates) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("page");
    next.delete("print");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shift(monthStart, -1);
  const presets = [
    { label: "7 days", from: shift(today, -6), to: today },
    { label: "30 days", from: shift(today, -29), to: today },
    { label: "90 days", from: shift(today, -89), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
    { label: "Year to date", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  const hasFilters = ["from", "to", "departmentId", "doctorId", "status"].some((k) => sp.get(k));

  return (
    <div className="flex flex-col gap-3 p-3 border-b border-border no-print">
      {uses("dateRange") && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="rf-from" className="field-label">From</label>
            <input id="rf-from" type="date" className="input w-[155px]" value={value.from} max={value.to} onChange={(e) => e.target.value && push({ from: e.target.value, to: value.to })} />
          </div>
          <div>
            <label htmlFor="rf-to" className="field-label">To</label>
            <input id="rf-to" type="date" className="input w-[155px]" value={value.to} min={value.from} onChange={(e) => e.target.value && push({ from: value.from, to: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Quick date ranges">
            {presets.map((p) => {
              const active = p.from === value.from && p.to === value.to;
              return (
                <button key={p.label} type="button" onClick={() => push({ from: p.from, to: p.to })} aria-pressed={active}
                  className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}>{p.label}</button>
              );
            })}
          </div>
        </div>
      )}
      {(uses("department") || uses("doctor") || uses("status")) && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          {uses("department") && (
            <select className="select sm:w-auto sm:min-w-[190px]" aria-label="Department" value={value.departmentId || ""} onChange={(e) => push({ departmentId: e.target.value })}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          )}
          {uses("doctor") && (
            <select className="select sm:w-auto sm:min-w-[190px]" aria-label="Doctor" value={value.doctorId || ""} onChange={(e) => push({ doctorId: e.target.value })}>
              <option value="">All doctors</option>
              {doctors.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          )}
          {uses("status") && (
            <select className="select sm:w-auto sm:min-w-[190px]" aria-label={statusLabel} value={value.status || ""} onChange={(e) => push({ status: e.target.value })}>
              {!defaultStatus && <option value="">{statusLabel}: All</option>}
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-muted min-h-[20px]">
        {pending && <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Updating…</span>}
        {hasFilters && !pending && <button type="button" className="inline-flex items-center gap-1 text-primary font-semibold hover:underline" onClick={() => start(() => router.replace(pathname, { scroll: false }))}><RotateCcw size={12} /> Reset filters</button>}
      </div>
    </div>
  );
}
