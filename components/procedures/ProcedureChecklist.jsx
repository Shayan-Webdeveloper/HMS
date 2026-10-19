"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { CHECKLIST_ITEMS, isChecklistComplete } from "@/lib/validation/procedures";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";

/** Pre-procedure safety checklist. Completion is only stored when every item is ticked. */
export function ProcedureChecklist({ procedureId, complete, confirmedBy, confirmedAt, canEdit, status }) {
  const router = useRouter();
  const [ticks, setTicks] = useState({});
  const [busy, setBusy] = useState(false);
  const all = isChecklistComplete(ticks);
  const done = Object.values(ticks).filter(Boolean).length;

  if (complete) {
    return (
      <div className="rounded-lg border border-success/30 bg-success-soft p-4">
        <p className="font-semibold text-success inline-flex items-center gap-2"><CheckCircle2 size={16} aria-hidden /> Checklist complete</p>
        <ul className="mt-2 space-y-1 text-[13px]">
          {CHECKLIST_ITEMS.map((i) => <li key={i.key} className="flex items-center gap-2"><CheckCircle2 size={14} className="text-success" aria-hidden />{i.label}</li>)}
        </ul>
        {confirmedBy && <p className="text-xs text-muted mt-2">Confirmed by {confirmedBy}{confirmedAt ? ` · ${confirmedAt}` : ""}</p>}
      </div>
    );
  }
  if (status !== "SCHEDULED") return <p className="text-[13px] text-muted">The checklist was not completed for this procedure.</p>;

  async function confirm() {
    setBusy(true);
    try { await mutate(`/api/procedures/${procedureId}/checklist`, { items: ticks }, { success: "Checklist confirmed" }); router.refresh(); }
    catch { /* handled */ } finally { setBusy(false); }
  }

  return (
    <div>
      <fieldset disabled={!canEdit} className="space-y-2">
        <legend className="sr-only">Pre-procedure checklist</legend>
        {CHECKLIST_ITEMS.map((i) => (
          <label key={i.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-[13.5px] ${canEdit ? "cursor-pointer" : "opacity-70"} ${ticks[i.key] ? "border-success/40 bg-success-soft" : "border-border hover:bg-surface-2"}`}>
            <input type="checkbox" className="checkbox" checked={!!ticks[i.key]} onChange={(e) => setTicks((t) => ({ ...t, [i.key]: e.target.checked }))} />
            {i.label}
          </label>
        ))}
      </fieldset>
      {canEdit ? (
        <div className="flex items-center justify-between gap-3 mt-3">
          <span className="text-xs text-muted tabular">{done}/{CHECKLIST_ITEMS.length} confirmed</span>
          <Button variant="success" icon={ShieldCheck} disabled={!all} loading={busy} onClick={confirm}>Confirm checklist</Button>
        </div>
      ) : <p className="text-xs text-muted mt-2">Only theatre staff with scheduling rights can confirm the checklist.</p>}
    </div>
  );
}
