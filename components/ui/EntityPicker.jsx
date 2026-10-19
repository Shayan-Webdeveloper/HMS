"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { api } from "./api-client";

/**
 * Async searchable picker (combobox) backed by an API list endpoint.
 * value: { id, label, sub? } | null
 */
export function EntityPicker({ endpoint, value, onChange, placeholder = "Search…", mapItem, invalid, describedBy, id: idProp, extraQuery = "", disabled }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api(`${endpoint}?q=${encodeURIComponent(q)}&pageSize=8${extraQuery}`, { signal: ctl.signal })
        .then((r) => { setItems(r.data.map(mapItem)); setActive(0); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, open, endpoint, mapItem, extraQuery]);

  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (value) {
    return (
      <div className="input flex items-center justify-between gap-2" style={{ height: "auto", minHeight: 38, paddingTop: 6, paddingBottom: 6 }}>
        <div className="min-w-0">
          <div className="font-medium truncate">{value.label}</div>
          {value.sub && <div className="text-xs text-muted truncate">{value.sub}</div>}
        </div>
        {!disabled && <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => onChange(null)} aria-label="Clear selection"><X size={14} /></button>}
      </div>
    );
  }

  const choose = (it) => { onChange(it); setOpen(false); setQ(""); };

  return (
    <div className="relative" ref={box}>
      <Search size={15} className="absolute left-3 top-[11px] text-subtle" aria-hidden />
      <input
        id={idProp} className="input pl-9" placeholder={placeholder} value={q} disabled={disabled}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && items[active]) { e.preventDefault(); choose(items[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 w-full card max-h-72 overflow-y-auto py-1 shadow-[var(--shadow-lg)]">
          {loading && <li className="px-3 py-2 text-muted text-[13px] flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Searching…</li>}
          {!loading && items.length === 0 && <li className="px-3 py-2 text-muted text-[13px]">No matches</li>}
          {!loading && items.map((it, i) => (
            <li key={it.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={`px-3 py-2 cursor-pointer ${i === active ? "bg-primary-soft" : "hover:bg-surface-2"}`}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(it); }}>
              <div className="font-medium text-[13.5px]">{it.label}</div>
              {it.sub && <div className="text-xs text-muted">{it.sub}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const mapPatient = (p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}`, sub: [p.mrn, p.phone].filter(Boolean).join(" · "), raw: p });
export const mapDoctor = (d) => ({ id: d.id, label: `Dr. ${d.name}`, sub: [d.specialty, d.departmentName].filter(Boolean).join(" · "), raw: d });

export function PatientSelector(props) {
  return <EntityPicker endpoint="/api/patients" mapItem={mapPatient} placeholder="Search by name, MRN or phone…" {...props} />;
}
export function DoctorSelector(props) {
  return <EntityPicker endpoint="/api/doctors" mapItem={mapDoctor} placeholder="Search doctors…" {...props} />;
}
