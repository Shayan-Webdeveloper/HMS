"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X, Download, Loader2 } from "lucide-react";

/**
 * URL-synchronised search + filter controls.
 * filters: [{ name, label, options:[{value,label}] }]
 * dateRange: boolean — shows from/to inputs.
 * exportHref: string — base CSV export URL; current filters are appended.
 */
export function FilterBar({ placeholder = "Search…", filters = [], dateRange, exportHref, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") || "");
  const [pending, start] = useTransition();
  const timer = useRef();

  function push(updates) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    clearTimeout(timer.current);
    if ((sp.get("q") || "") === q) return;
    timer.current = setTimeout(() => push({ q }), 350);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const exportUrl = exportHref ? `${exportHref}${exportHref.includes("?") ? "&" : "?"}${sp.toString()}` : null;

  return (
    <div className="flex flex-col gap-2 p-3 border-b border-border md:flex-row md:items-center md:flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
        <input type="search" className="input pl-9 pr-9" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} />
        {pending ? <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-subtle" aria-hidden />
          : q && <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-subtle hover:text-ink" aria-label="Clear search"><X size={14} /></button>}
      </div>
      {filters.map((f) => (
        <select key={f.name} className="select md:w-auto md:min-w-[150px]" aria-label={f.label} value={sp.get(f.name) || ""} onChange={(e) => push({ [f.name]: e.target.value })}>
          <option value="">{f.label}: All</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      {dateRange && (
        <div className="flex items-center gap-2">
          <input type="date" className="input md:w-[150px]" aria-label="From date" value={sp.get("from") || ""} onChange={(e) => push({ from: e.target.value })} />
          <span className="text-subtle text-xs">to</span>
          <input type="date" className="input md:w-[150px]" aria-label="To date" value={sp.get("to") || ""} onChange={(e) => push({ to: e.target.value })} />
        </div>
      )}
      {children}
      {exportUrl && <a href={exportUrl} className="btn btn-secondary" download><Download size={15} aria-hidden /> Export CSV</a>}
    </div>
  );
}
