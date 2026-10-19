"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { imagingCatalogSchema, MODALITIES, modalityLabel } from "@/lib/validation/radiology";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

let seq = 0;
const withKey = (i) => ({ key: `r${++seq}`, code: i.code ?? "", modality: i.modality ?? "XRAY", bodyPart: i.bodyPart ?? "", price: i.price ?? "" });
const sig = (rows) => JSON.stringify(rows.map(({ code, modality, bodyPart, price }) => [code.trim().toUpperCase(), modality, bodyPart.trim(), String(price).trim()]));

/** Editor for SystemSetting "imaging.catalog" — saved as a whole list (upsert). */
export function CatalogEditor({ items, canEdit, currency }) {
  const router = useRouter();
  const [initial] = useState(() => items.map(withKey));
  const [rows, setRows] = useState(initial);
  const [errors, setErrors] = useState({});
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState(false);
  const dirty = sig(rows) !== sig(initial);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? rows.filter((r) => `${r.code} ${r.bodyPart} ${r.modality}`.toLowerCase().includes(f)) : rows;
  }, [rows, filter]);

  const update = (key, field, value) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r))); setErrors((e) => ({ ...e, [key]: undefined })); };
  const add = () => { setFilter(""); setRows((rs) => [...rs, withKey({})]); };
  const remove = (key) => setRows((rs) => rs.filter((r) => r.key !== key));

  function validate() {
    const payload = { items: rows.map(({ code, modality, bodyPart, price }) => ({ code, modality, bodyPart, price })) };
    const parsed = imagingCatalogSchema.safeParse(payload);
    if (parsed.success) { setErrors({}); return parsed.data; }
    const errs = {};
    for (const iss of parsed.error.issues) {
      const idx = iss.path[1];
      if (typeof idx === "number" && rows[idx]) {
        const k = rows[idx].key;
        errs[k] = { ...(errs[k] || {}), [iss.path[2] || "code"]: iss.message };
      }
    }
    setErrors(errs);
    toast.error("Please correct the highlighted rows.");
    return null;
  }

  async function save() {
    const data = validate();
    if (!data) { setConfirm(false); return; }
    try {
      await api("/api/radiology/catalog", { method: "PUT", body: data });
      toast.success("Imaging catalogue saved");
      setConfirm(false);
      router.refresh();
    } catch (e) {
      toast.error(e.message);
      if (e.fields) {
        const errs = {};
        for (const [path, msg] of Object.entries(e.fields)) {
          const m = path.match(/^items\.(\d+)\.(\w+)$/);
          if (m && rows[Number(m[1])]) errs[rows[Number(m[1])].key] = { [m[2]]: msg };
        }
        setErrors(errs);
      }
      setConfirm(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2 p-3 border-b border-border sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input type="search" className="input pl-9" placeholder="Filter by code, examination or modality…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter catalogue" />
        </div>
        {canEdit && <Button icon={Plus} onClick={add}>Add examination</Button>}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted">The catalogue is empty. {canEdit ? "Add examinations so clinicians can request imaging." : ""}</p>
      ) : (
        <div className="table-wrap">
          <table className="table table-responsive">
            <caption className="sr-only">Imaging catalogue</caption>
            <thead><tr><th>Code</th><th>Modality</th><th>Examination / body part</th><th className="num">Price ({currency})</th>{canEdit && <th><span className="sr-only">Remove</span></th>}</tr></thead>
            <tbody>
              {visible.map((r) => {
                const e = errors[r.key] || {};
                return (
                  <tr key={r.key}>
                    <td data-label="Code">
                      {canEdit ? <input className="input font-mono uppercase min-w-[110px]" value={r.code} maxLength={30} onChange={(ev) => update(r.key, "code", ev.target.value)} aria-label="Code" aria-invalid={!!e.code} /> : <span className="font-mono font-semibold">{r.code}</span>}
                      {e.code && <p className="field-error">{e.code}</p>}
                    </td>
                    <td data-label="Modality">
                      {canEdit ? (
                        <select className="select min-w-[140px]" value={r.modality} onChange={(ev) => update(r.key, "modality", ev.target.value)} aria-label="Modality" aria-invalid={!!e.modality}>
                          {[...new Set([...MODALITIES, r.modality])].map((m) => <option key={m} value={m}>{modalityLabel(m)}</option>)}
                        </select>
                      ) : modalityLabel(r.modality)}
                      {e.modality && <p className="field-error">{e.modality}</p>}
                    </td>
                    <td data-label="Examination">
                      {canEdit ? <input className="input min-w-[200px]" value={r.bodyPart} maxLength={120} onChange={(ev) => update(r.key, "bodyPart", ev.target.value)} aria-label="Examination / body part" aria-invalid={!!e.bodyPart} /> : r.bodyPart}
                      {e.bodyPart && <p className="field-error">{e.bodyPart}</p>}
                    </td>
                    <td data-label="Price" className="num">
                      {canEdit ? <input className="input text-right tabular w-[130px] ml-auto" inputMode="decimal" value={r.price} onChange={(ev) => update(r.key, "price", ev.target.value)} aria-label="Price" aria-invalid={!!e.price} /> : r.price}
                      {e.price && <p className="field-error">{e.price}</p>}
                    </td>
                    {canEdit && <td data-label=""><Button size="sm" variant="ghost" iconOnly icon={Trash2} onClick={() => remove(r.key)} aria-label={`Remove ${r.code || "row"}`} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-border bg-surface-2 rounded-b-[var(--radius-lg)]">
          <p className="text-xs text-muted">{rows.length} examination{rows.length === 1 ? "" : "s"}{dirty ? " · unsaved changes" : ""}. Existing studies keep the price captured when they were requested.</p>
          <div className="flex gap-2">
            <Button icon={RotateCcw} disabled={!dirty} onClick={() => { setRows(initial); setErrors({}); }}>Discard</Button>
            <Button variant="primary" icon={Save} disabled={!dirty} onClick={() => { if (validate()) setConfirm(true); }}>Save catalogue</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="primary" title="Save imaging catalogue?"
        message={`The catalogue will be replaced with ${rows.length} examination(s). New requests use these prices immediately; the change is audited.`}
        confirmLabel="Save catalogue" onConfirm={save} />
    </div>
  );
}
