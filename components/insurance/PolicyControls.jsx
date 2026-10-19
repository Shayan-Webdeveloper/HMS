"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField, SelectField, TextareaField, CheckboxField } from "@/components/ui/Form";
import { PatientSelector } from "@/components/ui/EntityPicker";
import { mutate } from "@/components/ui/api-client";
import { policySchema } from "@/lib/validation/insurance";

export function AddPolicyButton({ providers }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)} disabled={!providers.length} title={providers.length ? undefined : "Add an active provider first"}>Add policy</Button>
      {open && <PolicyDialog providers={providers} onClose={() => setOpen(false)} />}
    </>
  );
}

export function PolicyRowActions({ policy, providers }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setOpen(true)} aria-label={`Edit policy ${policy.policyNumber}`}>Edit</Button>
      {open && <PolicyDialog policy={policy} providers={providers} onClose={() => setOpen(false)} />}
    </>
  );
}

function PolicyDialog({ policy, providers, onClose }) {
  const router = useRouter();
  const [patient, setPatient] = useState(policy ? { id: policy.patient.id, label: `${policy.patient.firstName} ${policy.patient.lastName}`, sub: policy.patient.mrn } : null);
  // Keep the policy's current provider selectable even if it has since been deactivated.
  const options = [...providers];
  if (policy && !options.some((p) => p.id === policy.provider.id)) options.push({ id: policy.provider.id, name: `${policy.provider.name} (inactive)` });
  const form = useForm({
    resolver: zodResolver(policySchema),
    defaultValues: {
      patientId: policy?.patient.id ?? "", providerId: policy?.provider.id ?? (providers[0]?.id ?? ""), policyNumber: policy?.policyNumber ?? "",
      coverageStart: policy?.coverageStart?.slice(0, 10) ?? "", coverageEnd: policy?.coverageEnd?.slice(0, 10) ?? "",
      coverageNotes: policy?.coverageNotes ?? "", isActive: policy?.isActive ?? true,
    },
  });
  const patientErr = form.formState.errors.patientId?.message;
  async function submit(values) {
    try {
      await mutate(policy ? `/api/insurance/policies/${policy.id}` : "/api/insurance/policies", values, { method: policy ? "PATCH" : "POST", form, success: policy ? "Policy updated" : "Policy added" });
      onClose(); router.refresh();
    } catch {}
  }
  return (
    <Modal open onClose={onClose} size="lg" title={policy ? `Edit policy ${policy.policyNumber}` : "Add insurance policy"}
      footer={<><Button onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>{policy ? "Save changes" : "Add policy"}</Button></>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid grid-cols-1 sm:grid-cols-2 gap-4" noValidate>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="pol-patient">Patient<span className="req">*</span></label>
          <PatientSelector id="pol-patient" value={patient} invalid={!!patientErr} describedBy={patientErr ? "pol-patient-err" : undefined}
            onChange={(p) => { setPatient(p); form.setValue("patientId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted }); }} />
          {patientErr && <p id="pol-patient-err" className="field-error" role="alert">{patientErr}</p>}
        </div>
        <SelectField form={form} name="providerId" label="Provider" required options={options.map((p) => ({ value: p.id, label: p.name }))} />
        <TextField form={form} name="policyNumber" label="Policy number" required autoComplete="off" hint="Unique per provider" />
        <TextField form={form} name="coverageStart" label="Coverage start" type="date" required />
        <TextField form={form} name="coverageEnd" label="Coverage end" type="date" required />
        <TextareaField form={form} name="coverageNotes" label="Coverage notes" className="sm:col-span-2" rows={2} hint="Limits, co-pay, exclusions as stated on the policy (no clinical details)." />
        <CheckboxField form={form} name="isActive" label="Active" />
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
  );
}
