"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, RefreshCw, AlertTriangle, FileClock, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { calcInvoiceTotals, formatMoney, D } from "@/lib/utils/money";
import { formatDate } from "@/lib/utils/time";
import { manualItemSchema, ITEM_CATEGORIES, categoryLabel } from "@/lib/validation/billing";

const CAT_TONE = { CONSULTATION: "primary", LAB: "info", IMAGING: "teal", PHARMACY: "success", PROCEDURE: "warning", BED: "neutral", MISC: "neutral" };
let rowSeq = 0;
const newRow = (over = {}) => ({ rid: `r${++rowSeq}`, catalogCode: "", category: "MISC", description: "", quantity: "1", unitPrice: "", ...over });

/**
 * Lists a patient's unbilled charges (checkboxes) plus manual items, and submits
 * `{ sources:[{sourceType, sourceId}], items:[…] }` via onSubmit. Prices of sourced charges are re-derived server-side.
 */
export function ChargePicker({ patientId, catalog, taxRate, currency, locale, tz, onSubmit, submitLabel = "Create draft invoice", showDrafts = true, onCancel }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [rows, setRows] = useState([]);
  const [rowErrors, setRowErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const money = useCallback((v) => formatMoney(v, currency, locale), [currency, locale]);

  const load = useCallback(async (keepSelection = false) => {
    setLoading(true); setError(null);
    try {
      const r = await api(`/api/billing/unbilled?patientId=${encodeURIComponent(patientId)}`);
      setData(r.data);
      setSelected((prev) => {
        const keys = new Set(r.data.charges.map((c) => c.key));
        if (keepSelection) return new Set([...prev].filter((k) => keys.has(k)));
        return new Set(r.data.charges.filter((c) => !c.interim).map((c) => c.key));
      });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const charges = useMemo(() => data?.charges ?? [], [data]);
  const allSelected = charges.length > 0 && charges.every((c) => selected.has(c.key));
  const toggle = (k) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(charges.map((c) => c.key)));

  const updateRow = (rid, patch) => setRows((rs) => rs.map((r) => (r.rid === rid ? { ...r, ...patch } : r)));
  const addCatalog = (code) => {
    const c = catalog.find((x) => x.code === code);
    if (!c) return;
    setRows((rs) => [...rs, newRow({ catalogCode: c.code, category: c.category, description: c.name, unitPrice: c.price })]);
    setPick("");
  };

  const preview = useMemo(() => {
    const lines = [];
    for (const c of charges) if (selected.has(c.key)) lines.push({ quantity: c.quantity, unitPrice: c.unitPrice, taxRate });
    for (const r of rows) {
      const q = Number(r.quantity);
      if (Number.isInteger(q) && q > 0 && /^\d{1,10}(\.\d{1,2})?$/.test(String(r.unitPrice).trim())) lines.push({ quantity: q, unitPrice: r.unitPrice, taxRate });
    }
    try { return { count: lines.length, ...calcInvoiceTotals(lines) }; } catch { return { count: lines.length, subtotal: "0", taxTotal: "0", total: "0" }; }
  }, [charges, selected, rows, taxRate]);

  async function submit() {
    const errs = {};
    const items = [];
    for (const r of rows) {
      const parsed = manualItemSchema.safeParse({ catalogCode: r.catalogCode || undefined, category: r.category, description: r.description, quantity: r.quantity, unitPrice: r.unitPrice });
      if (!parsed.success) {
        errs[r.rid] = {};
        for (const i of parsed.error.issues) errs[r.rid][i.path[0]] ??= i.message;
      } else items.push(parsed.data);
    }
    setRowErrors(errs);
    if (Object.keys(errs).length) { toast.error("Please correct the highlighted items."); return; }
    const sources = charges.filter((c) => selected.has(c.key)).map((c) => ({ sourceType: c.sourceType, sourceId: c.sourceId }));
    if (!sources.length && !items.length) { toast.error("Select at least one charge or add an item."); return; }
    setBusy(true);
    try {
      await onSubmit({ sources, items });
    } catch (e) {
      if (e?.status === 409) { toast.error(e.message); load(true); }
      else toast.error(e?.message || "Request failed");
    } finally { setBusy(false); }
  }

  if (loading && !data) {
    return <div className="space-y-3" aria-busy="true" aria-label="Loading charges">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (error) return <ErrorState title="Could not load unbilled charges" description={error} action={<Button icon={RefreshCw} onClick={() => load()}>Retry</Button>} />;

  return (
    <div className="space-y-6">
      {showDrafts && data?.drafts?.length > 0 && (
        <div role="note" className="rounded-lg border border-info/30 bg-info-soft px-3 py-2.5 text-[13px] text-info flex gap-2">
          <FileClock size={16} className="shrink-0 mt-0.5" aria-hidden />
          <div>
            This patient already has {data.drafts.length === 1 ? "a draft invoice" : `${data.drafts.length} draft invoices`}:{" "}
            {data.drafts.map((d, i) => <span key={d.id}>{i > 0 && ", "}<Link href={`/billing/${d.id}`} className="font-semibold underline">{d.invoiceNo}</Link> ({money(d.total)})</span>)}.
            {" "}You can add charges to it instead of creating another invoice.
          </div>
        </div>
      )}

      <section aria-labelledby="unbilled-h">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h3 id="unbilled-h" className="text-[13.5px] font-semibold">Unbilled charges <span className="text-muted font-normal">({charges.length})</span></h3>
          <div className="flex gap-2">
            {charges.length > 0 && <Button size="sm" variant="ghost" onClick={toggleAll}>{allSelected ? "Clear all" : "Select all"}</Button>}
            <Button size="sm" variant="ghost" icon={RefreshCw} loading={loading} onClick={() => load(true)}>Refresh</Button>
          </div>
        </div>
        {charges.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-strong"><EmptyState title="No unbilled charges" description="Finalized consultations, lab tests, imaging, dispensed medicines, bed days and completed procedures appear here once recorded." /></div>
        ) : (
          <ul className="rounded-lg border border-border divide-y divide-border">
            {charges.map((c) => {
              const id = `chg-${c.key.replace(/[^a-zA-Z0-9]/g, "")}`;
              return (
                <li key={c.key} className={`flex items-start gap-3 px-3 py-2.5 ${selected.has(c.key) ? "bg-primary-soft/40" : ""}`}>
                  <input id={id} type="checkbox" className="checkbox mt-1" checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
                  <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[13.5px]">{c.description}</span>
                      <Badge tone={CAT_TONE[c.category]} plain>{categoryLabel(c.category)}</Badge>
                      {c.interim && <Badge tone="warning" plain>Interim</Badge>}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      <span className="font-mono">{c.reference}</span> · {formatDate(c.date, tz)}
                      {c.quantity > 1 && <> · {c.quantity} × {money(c.unitPrice)}</>}
                    </div>
                  </label>
                  <span className="font-semibold tabular text-[13.5px] whitespace-nowrap">{money(c.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {data?.credits?.length > 0 && (
          <div role="note" className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
            <p className="font-semibold flex items-center gap-1.5"><Undo2 size={14} aria-hidden /> Returned after billing</p>
            <ul className="mt-1 list-disc pl-5">
              {data.credits.map((c) => <li key={c.sourceId}>{c.description} ({c.reference}) — {money(c.amount)}</li>)}
            </ul>
            <p className="mt-1 text-xs">Invoice lines cannot be negative. Issue a refund on the original invoice if the patient has paid for these.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="manual-h">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h3 id="manual-h" className="text-[13.5px] font-semibold">Other services</h3>
          <div className="flex flex-wrap gap-2">
            {catalog.length > 0 && (
              <select className="select w-auto min-w-[200px]" value={pick} onChange={(e) => addCatalog(e.target.value)} aria-label="Add a service from the catalogue">
                <option value="">Add from service catalogue…</option>
                {catalog.map((c) => <option key={c.code} value={c.code}>{c.name} — {money(c.price)}</option>)}
              </select>
            )}
            <Button size="md" icon={Plus} onClick={() => setRows((rs) => [...rs, newRow()])}>Custom item</Button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-[13px] text-muted">No additional services. Add catalogue services (e.g. ECG, dressing) or a custom miscellaneous item.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const e = rowErrors[r.rid] || {};
              const fromCatalog = !!r.catalogCode;
              return (
                <div key={r.rid} className="rounded-lg border border-border p-3 grid grid-cols-2 sm:grid-cols-[1fr_140px_90px_130px_auto] gap-3 items-start">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="field-label" htmlFor={`${r.rid}-d`}>Description<span className="req">*</span></label>
                    <input id={`${r.rid}-d`} className="input" value={r.description} onChange={(ev) => updateRow(r.rid, { description: ev.target.value })} readOnly={fromCatalog} aria-invalid={!!e.description} />
                    {fromCatalog && <p className="field-hint">Catalogue item {r.catalogCode} · price from settings</p>}
                    {e.description && <p className="field-error" role="alert">{e.description}</p>}
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`${r.rid}-c`}>Category</label>
                    <select id={`${r.rid}-c`} className="select" value={r.category} disabled={fromCatalog} onChange={(ev) => updateRow(r.rid, { category: ev.target.value })}>
                      {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`${r.rid}-q`}>Qty<span className="req">*</span></label>
                    <input id={`${r.rid}-q`} className="input tabular" inputMode="numeric" value={r.quantity} onChange={(ev) => updateRow(r.rid, { quantity: ev.target.value })} aria-invalid={!!e.quantity} />
                    {e.quantity && <p className="field-error" role="alert">{e.quantity}</p>}
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`${r.rid}-p`}>Unit price<span className="req">*</span></label>
                    <input id={`${r.rid}-p`} className="input tabular" inputMode="decimal" value={r.unitPrice} readOnly={fromCatalog} onChange={(ev) => updateRow(r.rid, { unitPrice: ev.target.value })} aria-invalid={!!e.unitPrice} placeholder="0.00" />
                    {e.unitPrice && <p className="field-error" role="alert">{e.unitPrice}</p>}
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex sm:pt-6 justify-end">
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setRows((rs) => rs.filter((x) => x.rid !== r.rid))} aria-label={`Remove ${r.description || "item"}`}>Remove</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="rounded-lg bg-surface-2 border border-border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-[13px] text-muted space-y-0.5">
          <p><span className="font-semibold text-ink">{preview.count}</span> line{preview.count === 1 ? "" : "s"} selected · tax {D(taxRate).toFixed(2)}% per line (billing settings)</p>
          <p className="text-xs flex items-center gap-1"><AlertTriangle size={12} aria-hidden /> Preview only — totals are recalculated by the server. Discounts can be applied on the draft.</p>
        </div>
        <div className="flex items-center gap-4 justify-between sm:justify-end">
          <div className="text-right">
            <p className="text-xs text-muted">Estimated total</p>
            <p className="text-[20px] font-bold tabular">{money(preview.total)}</p>
          </div>
          <div className="flex gap-2">
            {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
            <Button variant="primary" loading={busy} onClick={submit} disabled={preview.count === 0}>{submitLabel}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
