"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, ArchiveRestore, Pencil, CalendarPlus, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { PatientSelector } from "@/components/ui/EntityPicker";
import { mutate } from "@/components/ui/api-client";

export function PatientActions({ patient, canEdit, canArchive, canBook, canMerge }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [merge, setMerge] = useState(false);
  const archived = patient.status === "ARCHIVED";
  return (
    <div className="flex flex-wrap gap-2">
      {canBook && patient.status === "ACTIVE" && <Button variant="primary" icon={CalendarPlus} href={`/appointments/new?patientId=${patient.id}`}>Book appointment</Button>}
      {canEdit && <Button icon={Pencil} href={`/patients/${patient.id}/edit`}>Edit</Button>}
      {canArchive && <Button icon={archived ? ArchiveRestore : Archive} onClick={() => setConfirm(true)}>{archived ? "Restore" : "Archive"}</Button>}
      {canMerge && patient.status === "ACTIVE" && <Button icon={GitMerge} onClick={() => setMerge(true)}>Merge duplicate…</Button>}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} requireReason tone={archived ? "primary" : "danger"}
        title={archived ? "Restore patient record?" : "Archive patient record?"}
        message={archived ? "The patient will appear in active searches again." : "Archived patients are hidden from default searches. Clinical and financial history is preserved and the record can be restored."}
        confirmLabel={archived ? "Restore" : "Archive"}
        onConfirm={async (reason) => {
          try { await mutate(`/api/patients/${patient.id}/archive`, { archived: !archived, reason }, { success: archived ? "Patient restored" : "Patient archived" }); setConfirm(false); router.refresh(); } catch {}
        }} />
      {merge && <MergeDialog patient={patient} onClose={() => setMerge(false)} />}
    </div>
  );
}

function MergeDialog({ patient, onClose }) {
  const router = useRouter();
  const [dup, setDup] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await mutate("/api/patients/merge", { sourceId: dup.id, targetId: patient.id, reason }, { success: "Records merged" });
      onClose(); router.refresh();
    } catch {} finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Merge duplicate record" description={`All records from the duplicate move into ${patient.mrn}. The duplicate is marked MERGED (not deleted) and the action is audited.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!dup || reason.trim().length < 5} loading={busy} onClick={go}>Merge into {patient.mrn}</Button></>}>
      <div className="space-y-4">
        <div>
          <p className="field-label">Duplicate record to merge</p>
          <PatientSelector value={dup} onChange={setDup} />
          {dup?.id === patient.id && <p className="field-error">Choose a different patient.</p>}
        </div>
        <div>
          <label className="field-label" htmlFor="merge-reason">Reason<span className="req">*</span></label>
          <textarea id="merge-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Same person registered twice at front desk (verified ID)" />
        </div>
      </div>
    </Modal>
  );
}
