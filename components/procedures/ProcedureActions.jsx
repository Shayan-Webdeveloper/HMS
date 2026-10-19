"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Play, CheckCircle2, XCircle, Pencil } from "lucide-react";
import { mutate } from "@/components/ui/api-client";
import { procedureStartBlocker } from "@/lib/validation/procedures";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function ProcedureActions({ procedure, canManage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [cancel, setCancel] = useState(false);
  if (!canManage) return null;
  const blocker = procedure.status === "SCHEDULED" ? procedureStartBlocker(procedure) : null;

  async function start() {
    setBusy(true);
    try { await mutate(`/api/procedures/${procedure.id}/status`, { status: "IN_PROGRESS" }, { success: "Procedure started" }); router.refresh(); }
    catch { /* handled */ } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col items-start lg:items-end gap-1.5">
      <div className="flex flex-wrap gap-2">
        {procedure.status === "SCHEDULED" && <Button icon={Pencil} href={`/procedures/${procedure.id}/edit`}>Edit / reschedule</Button>}
        {procedure.status === "SCHEDULED" && <Button variant="primary" icon={Play} loading={busy} disabled={!!blocker} onClick={start} aria-describedby={blocker ? "start-blocker" : undefined}>Start procedure</Button>}
        {procedure.status === "IN_PROGRESS" && <Button variant="success" icon={CheckCircle2} onClick={() => setComplete(true)}>Complete</Button>}
        {["SCHEDULED", "IN_PROGRESS"].includes(procedure.status) && <Button variant="ghost" icon={XCircle} onClick={() => setCancel(true)}>Cancel</Button>}
      </div>
      {blocker && <p id="start-blocker" className="text-xs text-warning">{blocker}</p>}
      {complete && <CompleteDialog procedure={procedure} onClose={() => setComplete(false)} />}
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} requireReason title={`Cancel ${procedure.procedureNo}?`}
        message={procedure.status === "IN_PROGRESS" ? "The procedure is in progress. Cancelling records it as abandoned; this cannot be undone." : "The theatre slot will be released. This cannot be undone."}
        confirmLabel="Cancel procedure"
        onConfirm={async (reason) => {
          try { await mutate(`/api/procedures/${procedure.id}/status`, { status: "CANCELLED", reason }, { success: "Procedure cancelled" }); setCancel(false); router.refresh(); } catch { /* handled */ }
        }} />
    </div>
  );
}

function CompleteDialog({ procedure, onClose }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (notes.trim().length < 5) { setError("Post-operative notes are required"); return; }
    setBusy(true);
    try { await mutate(`/api/procedures/${procedure.id}/status`, { status: "COMPLETED", postOpNotes: notes.trim() }, { success: "Procedure completed" }); onClose(); router.refresh(); }
    catch (e) { setError(e.fields?.postOpNotes || ""); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Complete procedure" description="Post-operative notes are required and become part of the record."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="success" loading={busy} onClick={go}>Complete procedure</Button></>}>
      <label className="field-label" htmlFor="postop">Post-operative notes<span className="req" aria-hidden>*</span></label>
      <textarea id="postop" className="textarea" rows={9} value={notes} onChange={(e) => { setNotes(e.target.value); setError(""); }} aria-invalid={!!error || undefined}
        placeholder="Procedure performed, findings, complications, estimated blood loss, specimens, post-op instructions…" />
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>
  );
}
