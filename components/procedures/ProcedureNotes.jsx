"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Save } from "lucide-react";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";

export function ProcedureNotes({ procedureId, notes, editable }) {
  const router = useRouter();
  const [value, setValue] = useState(notes || "");
  const [busy, setBusy] = useState(false);
  if (!editable) return <p className="text-[13.5px] whitespace-pre-wrap">{notes || <span className="text-muted">No planning notes.</span>}</p>;
  async function save() {
    setBusy(true);
    try { await mutate(`/api/procedures/${procedureId}/notes`, { notes: value }, { success: "Notes saved" }); router.refresh(); } catch { /* handled */ } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor="proc-notes">Planning notes</label>
      <textarea id="proc-notes" className="textarea" rows={5} value={value} onChange={(e) => setValue(e.target.value)} maxLength={4000} placeholder="Anaesthesia plan, equipment, implants, special requirements…" />
      <div className="flex justify-end"><Button size="sm" icon={Save} loading={busy} disabled={value === (notes || "")} onClick={save}>Save notes</Button></div>
    </div>
  );
}
