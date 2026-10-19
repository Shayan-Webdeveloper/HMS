"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Loader2, RotateCcw, Download } from "lucide-react";

const FIELDS = ["user", "action", "entityType", "entityId", "from", "to"];

/** Audit log filters — applied on submit so typing does not fire a query per keystroke. */
export function AuditFilters({ entityTypes, exportHref }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, sp.get(k) || ""])));
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));

  function apply(e) {
    e?.preventDefault();
    const next = new URLSearchParams();
    for (const k of FIELDS) if (v[k]) next.set(k, v[k].trim());
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }
  function reset() {
    setV(Object.fromEntries(FIELDS.map((k) => [k, ""])));
    start(() => router.replace(pathname, { scroll: false }));
  }
  const qs = sp.toString();
  return (
    <form onSubmit={apply} className="p-3 border-b border-border grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto_auto] lg:items-end" noValidate>
      <div>
        <label htmlFor="af-user" className="field-label">User</label>
        <input id="af-user" className="input" placeholder="Name or email" value={v.user} onChange={set("user")} maxLength={100} />
      </div>
      <div>
        <label htmlFor="af-action" className="field-label">Action starts with</label>
        <input id="af-action" className="input font-mono text-[12.5px]" placeholder="e.g. patient. or user.create" value={v.action} onChange={set("action")} maxLength={60} />
      </div>
      <div>
        <label htmlFor="af-type" className="field-label">Entity type</label>
        <select id="af-type" className="select" value={v.entityType} onChange={set("entityType")}>
          <option value="">All types</option>
          {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="af-id" className="field-label">Entity ID</label>
        <input id="af-id" className="input font-mono text-[12.5px]" placeholder="exact id" value={v.entityId} onChange={set("entityId")} maxLength={64} />
      </div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <div className="flex-1">
          <label htmlFor="af-from" className="field-label">From</label>
          <input id="af-from" type="date" className="input" value={v.from} max={v.to || undefined} onChange={set("from")} />
        </div>
        <div className="flex-1">
          <label htmlFor="af-to" className="field-label">To</label>
          <input id="af-to" type="date" className="input" value={v.to} min={v.from || undefined} onChange={set("to")} />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button type="submit" className="btn btn-primary">{pending ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} aria-hidden />} Apply</button>
        <button type="button" className="btn btn-ghost" onClick={reset}><RotateCcw size={14} aria-hidden /> Reset</button>
        {exportHref && <a href={`${exportHref}${qs ? `?${qs}` : ""}`} className="btn btn-secondary" download><Download size={15} aria-hidden /> CSV</a>}
      </div>
    </form>
  );
}
