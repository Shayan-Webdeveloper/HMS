"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TestTube, Play, ShieldCheck, Ban, XCircle, Printer, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { mutate } from "@/components/ui/api-client";

/**
 * Workflow buttons for a lab order. Visibility mirrors the server rules; the server
 * still enforces every permission and transition.
 */
export function LabOrderActions({ order, perms, policy }) {
  const router = useRouter();
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(null);
  const base = `/api/lab/orders/${order.id}`;
  const close = () => setDialog(null);

  async function run(key, url, body, success) {
    setBusy(key);
    try { await mutate(url, body ?? {}, { success }); close(); router.refresh(); }
    catch { /* toast shown by mutate */ }
    finally { setBusy(null); }
  }

  const s = order.status;
  const canReject = perms.process && (s === "SAMPLE_COLLECTED" || s === "PROCESSING" || (s === "AWAITING_VALIDATION" && !order.hasValidatedResults));
  const canCancel = perms.cancel && (s === "REQUESTED" || s === "SAMPLE_COLLECTED");
  const blockedBySecond = policy.requireSecondValidator && policy.selfEnteredCount > 0;

  return (
    <div className="flex flex-wrap gap-2">
      {perms.process && s === "REQUESTED" && (
        <Button variant="primary" icon={TestTube} loading={busy === "collect"} onClick={() => setDialog("collect")}>Collect specimen</Button>
      )}
      {perms.process && s === "SAMPLE_COLLECTED" && (
        <Button variant="primary" icon={Play} loading={busy === "start"} onClick={() => run("start", `${base}/start`, null, "Processing started")}>Start processing</Button>
      )}
      {perms.validate && s === "AWAITING_VALIDATION" && (
        <Button variant="success" icon={ShieldCheck} onClick={() => setDialog("release")} disabled={blockedBySecond}
          title={blockedBySecond ? "Another authorised user must validate results you entered" : undefined}>Validate &amp; release</Button>
      )}
      {s === "RELEASED" && <Button icon={Printer} href={`/laboratory/${order.id}/report`}>Print report</Button>}
      {canReject && <Button icon={XCircle} onClick={() => setDialog("reject")}>Reject specimen</Button>}
      {canCancel && <Button variant="ghost" icon={Ban} onClick={() => setDialog("cancel")}>Cancel order</Button>}

      {blockedBySecond && perms.validate && s === "AWAITING_VALIDATION" && (
        <p className="basis-full text-xs text-warning flex items-center gap-1.5"><AlertTriangle size={13} aria-hidden />Second-person validation is enabled: you entered {policy.selfEnteredCount} of the pending result(s).</p>
      )}

      <ConfirmDialog open={dialog === "collect"} onClose={close} tone="primary" title="Record specimen collection?"
        message={`One specimen will be registered per specimen type (${order.specimenTypes.join(", ")}) with a unique specimen number, collected by you now.`}
        confirmLabel="Record collection" onConfirm={() => run("collect", `${base}/collect`, null, "Specimen collected")} />

      <ConfirmDialog open={dialog === "release"} onClose={close} tone="primary" title="Validate and release results?"
        message={[
          `Released results become visible to the ordering clinician${order.hasPortal ? " and the patient portal" : ""}. They can only be changed afterwards through an audited correction.`,
          policy.selfEnteredCount > 0 ? ` You entered ${policy.selfEnteredCount} of these result(s); self-validation will be recorded in the audit trail.` : "",
        ].join("")}
        confirmLabel="Validate & release" onConfirm={() => run("release", `${base}/release`, null, "Results released")} />

      <ConfirmDialog open={dialog === "cancel"} onClose={close} requireReason title={`Cancel order ${order.orderNo}?`}
        message="The order will be cancelled and the requesting clinician notified. This cannot be undone."
        confirmLabel="Cancel order" onConfirm={(reason) => run("cancel", `${base}/cancel`, { reason }, "Order cancelled")} />

      {dialog === "reject" && <RejectDialog onClose={close} busy={busy === "reject"} onSubmit={(body) => run("reject", `${base}/reject-specimen`, body, body.recollect ? "Specimen rejected: recollection requested" : "Order rejected")} />}
    </div>
  );
}

const REJECT_REASONS = ["Haemolysed sample", "Clotted sample", "Insufficient volume", "Wrong container / tube", "Unlabelled or mislabelled", "Delayed transport"];

function RejectDialog({ onClose, onSubmit, busy }) {
  const [reason, setReason] = useState("");
  const [recollect, setRecollect] = useState(true);
  const [error, setError] = useState("");
  function go() {
    if (reason.trim().length < 3) { setError("Please give a reason (min 3 characters)."); return; }
    onSubmit({ reason: reason.trim(), recollect });
  }
  return (
    <Modal open onClose={() => !busy && onClose()} title="Reject specimen"
      description="The collected specimen is marked rejected. Any unvalidated results from it are retired (kept for traceability)."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={go}>Reject specimen</Button></>}>
      <div className="space-y-4">
        <div>
          <label className="field-label" htmlFor="rej-reason">Reason<span className="req">*</span></label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {REJECT_REASONS.map((r) => <button key={r} type="button" className="badge badge-neutral badge-plain hover:bg-primary-soft cursor-pointer" onClick={() => { setReason(r); setError(""); }}>{r}</button>)}
          </div>
          <textarea id="rej-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "rej-err" : undefined} maxLength={300} />
          {error && <p id="rej-err" className="field-error" role="alert">{error}</p>}
        </div>
        <fieldset className="space-y-2">
          <legend className="field-label">Next step</legend>
          <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
            <input type="radio" name="recollect" className="mt-1" checked={recollect} onChange={() => setRecollect(true)} />
            <span><span className="font-semibold text-[13.5px]">Recollect</span><span className="block text-xs text-muted">Order returns to "awaiting collection" and the lab is alerted to draw a new specimen.</span></span>
          </label>
          <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 cursor-pointer has-[:checked]:border-danger has-[:checked]:bg-danger-soft">
            <input type="radio" name="recollect" className="mt-1" checked={!recollect} onChange={() => setRecollect(false)} />
            <span><span className="font-semibold text-[13.5px]">Do not recollect</span><span className="block text-xs text-muted">The order is closed as REJECTED. The ordering doctor is notified.</span></span>
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}
