"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Footprints, Info } from "lucide-react";
import { walkInSchema } from "@/lib/validation/appointments";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FormField, Select, Input, TextField } from "@/components/ui/Form";
import { PatientSelector } from "@/components/ui/EntityPicker";

/** Register a walk-in: creates a WALK_IN appointment starting now, checked in with a queue token. */
export function WalkInButton({ doctors, canEditFee, currency, defaultDoctorId, redirectTo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [patient, setPatient] = useState(null);
  const form = useForm({ resolver: zodResolver(walkInSchema), defaultValues: { patientId: "", doctorId: defaultDoctorId || "", reason: "", notes: "", fee: doctors.find((d) => d.id === defaultDoctorId)?.consultationFee ?? "" } });
  const err = form.formState.errors;
  const doctorId = useWatch({ control: form.control, name: "doctorId" });

  function close() { setOpen(false); setPatient(null); form.reset(); }

  async function onSubmit(v) {
    try {
      const r = await api("/api/appointments/walk-in", { method: "POST", body: { ...v, fee: canEditFee ? v.fee : undefined } });
      toast.success(`Walk-in registered — token #${r.data.queueEntry.tokenNumber} (${r.data.appointmentNo})`);
      close();
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }

  return (
    <>
      <Button icon={Footprints} onClick={() => setOpen(true)}>Walk-in</Button>
      <Modal open={open} onClose={close} title="Register walk-in" description="The patient is checked in immediately and joins the doctor's queue."
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Check in walk-in</Button></>}>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FormField label="Patient" required error={err.patientId && "Choose a patient"}>
            {(a) => <PatientSelector id={a.id} invalid={!!err.patientId} value={patient} onChange={(p) => { setPatient(p); form.setValue("patientId", p?.id ?? "", { shouldValidate: !!p }); }} />}
          </FormField>
          <FormField label="Doctor" required error={err.doctorId && "Choose a doctor"}>
            {(a) => (
              <Select {...a} value={doctorId} onChange={(e) => { form.setValue("doctorId", e.target.value, { shouldValidate: true }); form.setValue("fee", doctors.find((d) => d.id === e.target.value)?.consultationFee ?? ""); }}>
                <option value="">Select a doctor…</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.name} — {d.departmentName}</option>)}
              </Select>
            )}
          </FormField>
          <TextField form={form} name="reason" label="Reason for visit" />
          <FormField label={`Fee (${currency})`} error={err.fee?.message}>
            {(a) => <Input {...a} {...form.register("fee")} readOnly={!canEditFee} className={!canEditFee ? "bg-surface-2" : ""} inputMode="decimal" />}
          </FormField>
          <p className="text-[12px] text-muted flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" aria-hidden />Walk-ins bypass the doctor's booking windows and are seen in token order. Doctor leave/exceptions and patient double-booking are still checked.</p>
        </form>
      </Modal>
    </>
  );
}
