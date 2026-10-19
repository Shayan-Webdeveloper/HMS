"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { procedureSchema } from "@/lib/validation/procedures";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { FormSection, TextField, SelectField, TextareaField } from "@/components/ui/Form";
import { PatientSelector, DoctorSelector } from "@/components/ui/EntityPicker";

export function ProcedureForm({ procedure, initialPatient, initialSurgeon, theatres, defaultDate, currency }) {
  const router = useRouter();
  const [patient, setPatient] = useState(initialPatient || null);
  const [surgeon, setSurgeon] = useState(initialSurgeon || null);
  const form = useForm({
    resolver: zodResolver(procedureSchema),
    defaultValues: {
      patientId: initialPatient?.id ?? "", surgeonId: initialSurgeon?.id ?? "", theatreId: procedure?.theatreId ?? theatres[0]?.id ?? "",
      name: procedure?.name ?? "", date: procedure?.date ?? defaultDate, startTime: procedure?.startTime ?? "09:00", endTime: procedure?.endTime ?? "10:00",
      charge: procedure?.charge ?? "", notes: procedure?.notes ?? "",
    },
  });
  const errors = form.formState.errors;

  async function submit(values) {
    try {
      const r = await mutate(procedure ? `/api/procedures/${procedure.id}` : "/api/procedures", values, { method: procedure ? "PATCH" : "POST", success: procedure ? "Procedure updated" : "Procedure scheduled", form });
      router.push(`/procedures/${procedure ? procedure.id : r.id}`);
      router.refresh();
    } catch { /* handled — clashes are shown on the theatre / surgeon fields */ }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>
      <FormSection title="Patient & surgeon">
        <div className="sm:col-span-2">
          <p className="field-label">Patient<span className="req" aria-hidden>*</span></p>
          <PatientSelector value={patient} disabled={!!procedure} invalid={!!errors.patientId} onChange={(p) => { setPatient(p); form.setValue("patientId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted }); }} />
          {errors.patientId && <p className="field-error" role="alert">{errors.patientId.type === "server" ? errors.patientId.message : "Select the patient"}</p>}
        </div>
        <div className="sm:col-span-2">
          <p className="field-label">Surgeon<span className="req" aria-hidden>*</span></p>
          <DoctorSelector value={surgeon} invalid={!!errors.surgeonId} onChange={(d) => { setSurgeon(d); form.setValue("surgeonId", d?.id ?? "", { shouldValidate: form.formState.isSubmitted }); }} />
          {errors.surgeonId && <p className="field-error" role="alert">{errors.surgeonId.message}</p>}
        </div>
      </FormSection>
      <FormSection title="Booking" description="Times are in the hospital time zone. Clashes with the same theatre or surgeon are rejected.">
        <TextField form={form} name="name" label="Procedure" required className="sm:col-span-2" placeholder="e.g. Laparoscopic cholecystectomy" />
        <SelectField form={form} name="theatreId" label="Theatre" required placeholder={theatres.length ? undefined : "No active theatres"} options={theatres.map((t) => ({ value: t.id, label: t.name }))} />
        <TextField form={form} name="date" type="date" label="Date" required />
        <TextField form={form} name="startTime" type="time" label="Start" required />
        <TextField form={form} name="endTime" type="time" label="End" required />
        <TextField form={form} name="charge" label={`Charge (${currency})`} required inputMode="decimal" placeholder="0.00" />
        <TextareaField form={form} name="notes" label="Planning notes" rows={3} className="sm:col-span-2" hint="Optional — anaesthesia plan, equipment, implants, special requirements." />
      </FormSection>
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button href={procedure ? `/procedures/${procedure.id}` : "/procedures"}>Cancel</Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>{procedure ? "Save changes" : "Schedule procedure"}</Button>
      </div>
    </form>
  );
}
