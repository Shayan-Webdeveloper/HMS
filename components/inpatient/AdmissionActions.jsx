"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRightLeft, Printer, FileText, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { mutate } from "@/components/ui/api-client";
import { BedPicker } from "./BedPicker";

export function AdmissionActions({ admission, wards, canTransfer, canDischarge, canClinical }) {
  const [transfer, setTransfer] = useState(false);
  const open = admission.status === "ADMITTED";
  return (
    <div className="flex flex-wrap gap-2 no-print">
      {open && canTransfer && <Button icon={ArrowRightLeft} onClick={() => setTransfer(true)}>Transfer bed</Button>}
      {open && canDischarge && <Button variant="primary" icon={LogOut} href={`/admissions/${admission.id}?tab=discharge`}>Discharge</Button>}
      <Button icon={Printer} href={`/admissions/${admission.id}/print`}>Admission summary</Button>
      {!open && admission.status === "DISCHARGED" && canClinical && <Button icon={FileText} href={`/admissions/${admission.id}/discharge-summary`}>Discharge summary</Button>}
      {transfer && <TransferDialog admission={admission} wards={wards} onClose={() => setTransfer(false)} />}
    </div>
  );
}

function TransferDialog({ admission, wards, onClose }) {
  const router = useRouter();
  const [wardId, setWardId] = useState("");
  const [bedId, setBedId] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  async function go() {
    const e = {};
    if (!wardId) e.wardId = "Choose a ward";
    if (!bedId) e.bedId = "Choose the new bed";
    if (reason.trim().length < 3) e.reason = "Give a reason for the transfer";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await mutate(`/api/admissions/${admission.id}/transfer`, { wardId, bedId, reason: reason.trim() }, { success: "Patient transferred" });
      onClose();
      router.refresh();
    } catch (err) {
      if (err.fields) setErrors(err.fields);
      if (err.status === 409) { setBedId(""); setRefresh((n) => n + 1); }
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Transfer to another bed"
      description={`Current bed: ${admission.currentBedLabel || "none"}. The current bed is released for cleaning and the new bed is claimed in one step.`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Transfer</Button></>}>
      <div className="space-y-4">
        <BedPicker wards={wards} wardId={wardId} bedId={bedId} onWardChange={setWardId} onBedChange={setBedId} excludeBedId={admission.currentBedId} refreshKey={refresh} wardError={errors.wardId} bedError={errors.bedId} />
        <div>
          <label className="field-label" htmlFor="transfer-reason">Reason<span className="req" aria-hidden>*</span></label>
          <textarea id="transfer-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Step-down from ICU, isolation required, patient request" aria-invalid={!!errors.reason || undefined} />
          {errors.reason && <p className="field-error" role="alert">{errors.reason}</p>}
        </div>
      </div>
    </Modal>
  );
}
