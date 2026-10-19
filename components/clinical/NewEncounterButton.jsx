"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2 } from "lucide-react";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FormField, Input } from "@/components/ui/Form";
import { PatientSelector } from "@/components/ui/EntityPicker";

/** Open an ad-hoc OPD consultation (no appointment) for the signed-in doctor. */
export function NewEncounterButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [patient, setPatient] = useState(null);
  const [cc, setCc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  function close() { setOpen(false); setPatient(null); setCc(""); setError(null); }
  async function go() {
    if (!patient) { setError("Choose a patient"); return; }
    setBusy(true);
    try {
      const r = await api("/api/encounters", { method: "POST", body: { patientId: patient.id, chiefComplaint: cc || undefined } });
      toast.success(r.data.reopened ? "Re-opened today's draft consultation" : "Consultation opened");
      router.push(`/consultations/${r.data.encounterId}`);
    } catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <>
      <Button icon={FilePlus2} onClick={() => setOpen(true)}>New consultation</Button>
      <Modal open={open} onClose={close} title="New consultation" description="For patients seen without an appointment in your queue. Use Walk-in to add them to the queue instead."
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Open consultation</Button></>}>
        <div className="grid gap-4">
          <FormField label="Patient" required error={error}>
            {(a) => <PatientSelector id={a.id} invalid={!!error} value={patient} onChange={(p) => { setPatient(p); setError(null); }} />}
          </FormField>
          <FormField label="Chief complaint (optional)">
            {(a) => <Input {...a} value={cc} onChange={(e) => setCc(e.target.value)} maxLength={500} />}
          </FormField>
        </div>
      </Modal>
    </>
  );
}
