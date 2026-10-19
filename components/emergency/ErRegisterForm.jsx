"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, UserSearch, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { erRegisterSchema, ARRIVAL_MODES } from "@/lib/validation/emergency";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { FormSection, TextField, SelectField, TextareaField } from "@/components/ui/Form";
import { PatientSelector } from "@/components/ui/EntityPicker";

const label = (s) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export function ErRegisterForm({ initialPatient, defaultArrivalMode = "WALK_IN" }) {
  const router = useRouter();
  const [patient, setPatient] = useState(initialPatient || null);
  const [openVisit, setOpenVisit] = useState(null);
  const form = useForm({
    resolver: zodResolver(erRegisterSchema),
    defaultValues: {
      patientMode: "EXISTING", patientId: initialPatient?.id ?? "",
      newPatient: { firstName: "", lastName: "", sex: "UNKNOWN", dateOfBirth: "", phone: "" },
      arrivalMode: defaultArrivalMode, presentingComplaint: "", initialObservations: "",
    },
  });
  const mode = useWatch({ control: form.control, name: "patientMode" });
  const errors = form.formState.errors;

  async function submit(values) {
    try {
      const r = await api("/api/emergency", { method: "POST", body: values });
      toast.success(`ER visit registered — ${r.data.visitNo}`);
      router.push(`/emergency/${r.data.id}`);
      router.refresh();
    } catch (e) {
      if (e.status === 409 && e.fields?.visitId) setOpenVisit(e.fields.visitId);
      handleFormError(e, form);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>
      {openVisit && (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-[13.5px]">
          <p className="font-semibold text-warning flex items-center gap-2"><AlertTriangle size={16} /> Patient already in the department</p>
          <p className="text-muted mt-1"><Link className="text-primary font-semibold hover:underline" href={`/emergency/${openVisit}`}>Open the current ER visit</Link> instead of registering a new one.</p>
        </div>
      )}
      <fieldset>
        <legend className="text-[13px] font-semibold mb-2">Patient</legend>
        <div role="radiogroup" aria-label="Patient" className="flex flex-wrap gap-2 mb-4">
          {[["EXISTING", "Existing patient", UserSearch], ["NEW", "Quick register new patient", UserPlus]].map(([k, l, Icon]) => (
            <label key={k} className={`btn btn-sm ${mode === k ? "btn-primary" : "btn-secondary"}`}>
              <input type="radio" className="sr-only" value={k} {...form.register("patientMode")} /> <Icon size={14} aria-hidden /> {l}
            </label>
          ))}
        </div>
        {mode === "EXISTING" ? (
          <div>
            <p className="field-label">Search patient<span className="req" aria-hidden>*</span></p>
            <PatientSelector value={patient} invalid={!!errors.patientId} onChange={(p) => { setPatient(p); setOpenVisit(null); form.setValue("patientId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted }); }} />
            {errors.patientId && <p className="field-error" role="alert">{errors.patientId.message}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField form={form} name="newPatient.firstName" label="First name" required autoComplete="off" />
            <TextField form={form} name="newPatient.lastName" label="Last name" required autoComplete="off" hint="Use “Unknown” if the patient cannot be identified yet." />
            <SelectField form={form} name="newPatient.sex" label="Sex" options={["MALE", "FEMALE", "OTHER", "UNKNOWN"].map((s) => ({ value: s, label: label(s) }))} />
            <TextField form={form} name="newPatient.dateOfBirth" type="date" label="Date of birth" hint="Approximate if the exact date is unknown." />
            <TextField form={form} name="newPatient.phone" type="tel" label="Phone" />
            <p className="text-xs text-muted sm:col-span-2">A full MRN is created now; complete the demographics later from the patient record. Duplicates can be merged afterwards.</p>
          </div>
        )}
      </fieldset>

      <FormSection title="Arrival">
        <SelectField form={form} name="arrivalMode" label="Arrival mode" required options={ARRIVAL_MODES.map((m) => ({ value: m, label: label(m) }))} />
        <div className="hidden sm:block" />
        <TextareaField form={form} name="presentingComplaint" label="Presenting complaint" required rows={2} className="sm:col-span-2" />
        <TextareaField form={form} name="initialObservations" label="Initial observations" rows={3} className="sm:col-span-2" hint="Optional — e.g. measured vitals or what was seen on arrival. Triage category is chosen separately by staff." />
      </FormSection>

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button href="/emergency">Cancel</Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Register arrival</Button>
      </div>
    </form>
  );
}
