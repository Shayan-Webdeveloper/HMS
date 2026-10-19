"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { mutate } from "@/components/ui/api-client";
import { addBedsSchema, nextBedLabels, parseBedLabels } from "@/lib/validation/inpatient";

export function AddBedsDialog({ ward, existingLabels }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("sequence");
  const [count, setCount] = useState(1);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const labels = useMemo(() => (mode === "sequence" ? nextBedLabels(ward.code, existingLabels, Math.min(Math.max(Number(count) || 0, 0), 50)) : parseBedLabels(text)), [mode, count, text, ward.code, existingLabels]);
  const clash = labels.filter((l) => existingLabels.some((e) => e.toLowerCase() === l.toLowerCase()));

  async function submit() {
    setError("");
    const parsed = addBedsSchema.safeParse({ labels });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Check the labels"); return; }
    if (clash.length) { setError(`Already in this ward: ${clash.join(", ")}`); return; }
    setBusy(true);
    try {
      const r = await mutate(`/api/wards/${ward.id}/beds`, { labels: parsed.data.labels }, { success: `${labels.length} bed${labels.length === 1 ? "" : "s"} added` });
      if (r) { setOpen(false); setText(""); setCount(1); router.refresh(); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>Add beds</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Add beds to ${ward.code}`} description="Labels must be unique within the ward. New beds start as available."
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} disabled={!labels.length}>Add {labels.length || ""} bed{labels.length === 1 ? "" : "s"}</Button></>}>
        <div className="space-y-4">
          <div role="radiogroup" aria-label="How to add beds" className="flex gap-2">
            <label className={`btn btn-sm ${mode === "sequence" ? "btn-primary" : "btn-secondary"}`}>
              <input type="radio" className="sr-only" name="bed-mode" checked={mode === "sequence"} onChange={() => setMode("sequence")} /> Next in sequence
            </label>
            <label className={`btn btn-sm ${mode === "custom" ? "btn-primary" : "btn-secondary"}`}>
              <input type="radio" className="sr-only" name="bed-mode" checked={mode === "custom"} onChange={() => setMode("custom")} /> Custom labels
            </label>
          </div>
          {mode === "sequence" ? (
            <div>
              <label className="field-label" htmlFor="bed-count">Number of beds</label>
              <input id="bed-count" type="number" min={1} max={50} className="input max-w-[140px]" value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="field-label" htmlFor="bed-labels">Labels</label>
              <textarea id="bed-labels" className="textarea" placeholder={`${ward.code}-A1, ${ward.code}-A2`} value={text} onChange={(e) => setText(e.target.value)} />
              <p className="field-hint">Separate labels with commas or new lines (max 50).</p>
            </div>
          )}
          {labels.length > 0 && (
            <div>
              <p className="text-xs text-muted mb-1.5">Preview</p>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((l) => <span key={l} className={`font-mono text-[12px] px-2 py-0.5 rounded border ${clash.includes(l) ? "border-danger text-danger bg-danger-soft" : "border-border bg-surface-2"}`}>{l}</span>)}
              </div>
            </div>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
