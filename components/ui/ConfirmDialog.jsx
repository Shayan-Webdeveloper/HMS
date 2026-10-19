"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

/**
 * Confirmation dialog. If `requireReason`, a reason textarea is shown and passed to onConfirm(reason).
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = "Confirm", tone = "danger", requireReason, reasonLabel = "Reason" }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    if (requireReason && reason.trim().length < 3) { setError("Please give a reason (min 3 characters)."); return; }
    setBusy(true);
    try { await onConfirm(reason.trim()); setReason(""); setError(""); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={title}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={go} loading={busy}>{confirmLabel}</Button>
      </>}>
      <p className="text-[13.5px] text-muted">{message}</p>
      {requireReason && (
        <div className="mt-4">
          <label className="field-label" htmlFor="confirm-reason">{reasonLabel}<span className="req">*</span></label>
          <textarea id="confirm-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "confirm-reason-err" : undefined} />
          {error && <p id="confirm-reason-err" className="field-error" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
