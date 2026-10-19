"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Lock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { CorrectResultButton } from "./CorrectResultButton";
import { resultEntrySchema, flagForResult, describeReference, parseNumericValue } from "@/lib/validation/lab";

/**
 * Result entry for lab staff. Only rows whose value/unit/comment changed are sent,
 * so re-saving never re-attributes someone else's entry. Flags preview the server's
 * calculation (numeric comparison against the configured range only).
 */
export function ResultEntryForm({ orderId, items, status, canCorrect = false }) {
  const router = useRouter();
  const init = Object.fromEntries(items.map((it) => [it.id, {
    value: it.current?.value ?? "",
    unit: it.current?.unit ?? it.test.unit ?? "",
    comment: it.current?.comment ?? "",
  }]));
  const [rows, setRows] = useState(init);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const editable = items.filter((it) => !it.current?.validatedAt);
  const set = (id, k, v) => { setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } })); setErrors((e) => ({ ...e, [id]: undefined })); };

  const changed = editable.filter((it) => {
    const r = rows[it.id], c = it.current;
    if (!c) return r.value.trim() !== "";
    return r.value.trim() !== c.value || (r.unit.trim() || "") !== (c.unit || "") || (r.comment.trim() || "") !== (c.comment || "");
  });

  async function save() {
    const errs = {};
    for (const it of changed) if (!rows[it.id].value.trim()) errs[it.id] = "Enter a result (a saved result cannot be blanked; correct it instead).";
    const payload = { results: changed.filter((it) => !errs[it.id]).map((it) => ({ orderItemId: it.id, value: rows[it.id].value, unit: rows[it.id].unit, comment: rows[it.id].comment })) };
    const parsed = resultEntrySchema.safeParse(payload);
    if (!parsed.success) {
      for (const iss of parsed.error.issues) {
        const idx = iss.path[1];
        if (typeof idx === "number") errs[payload.results[idx].orderItemId] = iss.message;
      }
    }
    if (Object.keys(errs).length) { setErrors(errs); toast.error("Please correct the highlighted results."); return; }
    if (!payload.results.length) { toast.info("No changes to save."); return; }
    setBusy(true);
    try {
      const r = await api(`/api/lab/orders/${orderId}/results`, { method: "POST", body: parsed.data });
      toast.success(r.data.status === "AWAITING_VALIDATION" && status === "PROCESSING" ? "Results saved: order is ready for validation" : r.data.missing ? `Results saved (${r.data.missing} still pending)` : "Results saved");
      router.refresh();
    } catch (e) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <ul className="divide-y divide-border">
        {items.map((it) => {
          const r = rows[it.id];
          const locked = !!it.current?.validatedAt;
          const range = describeReference(it.test);
          const flag = r.value.trim() ? flagForResult(it.test, r.value, r.unit) : null;
          const numeric = parseNumericValue(r.value) != null;
          const unitMismatch = it.test.unit && r.unit.trim() && r.unit.trim() !== it.test.unit;
          const err = errors[it.id];
          return (
            <li key={it.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2.5">
                <div className="min-w-0">
                  <p className="font-semibold text-[13.5px]">{it.test.name} <span className="font-mono text-[11.5px] text-subtle font-normal">{it.test.code}</span></p>
                  <p className="text-xs text-muted">Reference: {range || "not configured"}</p>
                </div>
                <div className="flex items-center gap-2">
                  {locked ? <span className="badge badge-success badge-plain"><Lock size={11} aria-hidden /> Validated</span>
                    : it.current ? <span className="badge badge-warning badge-plain">Draft</span>
                    : <span className="badge badge-neutral badge-plain">Pending</span>}
                  {flag && <StatusBadge status={flag} />}
                  {locked && canCorrect && <CorrectResultButton orderId={orderId} item={it} released={status === "RELEASED"} />}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1.3fr)] gap-2.5">
                <div>
                  <label className="field-label" htmlFor={`v-${it.id}`}>Result</label>
                  <input id={`v-${it.id}`} className="input tabular" value={r.value} disabled={locked || busy} maxLength={100} autoComplete="off"
                    onChange={(e) => set(it.id, "value", e.target.value)} aria-invalid={!!err} aria-describedby={err ? `e-${it.id}` : `h-${it.id}`} />
                </div>
                <div>
                  <label className="field-label" htmlFor={`u-${it.id}`}>Unit</label>
                  <input id={`u-${it.id}`} className="input" value={r.unit} disabled={locked || busy} maxLength={40} onChange={(e) => set(it.id, "unit", e.target.value)} />
                </div>
                <div>
                  <label className="field-label" htmlFor={`c-${it.id}`}>Comment <span className="text-subtle font-normal">(optional)</span></label>
                  <input id={`c-${it.id}`} className="input" value={r.comment} disabled={locked || busy} maxLength={500} onChange={(e) => set(it.id, "comment", e.target.value)} />
                </div>
              </div>
              {err ? <p id={`e-${it.id}`} className="field-error" role="alert">{err}</p> : (
                <p id={`h-${it.id}`} className="field-hint">
                  {!r.value.trim() ? "Numeric values are flagged against the configured range; text results are not flagged."
                    : unitMismatch ? `Unit differs from the configured unit (${it.test.unit}); the result will not be flagged.`
                    : !numeric ? "Text result: no flag is calculated."
                    : flag ? `Flag calculated from the configured range: ${flag.toLowerCase()}.` : "No numeric range configured: no flag."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {editable.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-border bg-surface-2 rounded-b-[var(--radius-lg)]">
          <p className="text-xs text-muted">{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "No unsaved changes"} · The order moves to validation once every test has a result.</p>
          <Button variant="primary" icon={Save} loading={busy} onClick={save} disabled={!changed.length}>Save results</Button>
        </div>
      )}
    </div>
  );
}
