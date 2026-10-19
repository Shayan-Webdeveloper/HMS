"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { admissionSchema } from "@/lib/validation/inpatient";
import { api, handleFormError } from "@/components/ui/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { FormSection, TextField, TextareaField } from "@/components/ui/Form";
import { PatientSelector, DoctorSelector } from "@/components/ui/EntityPicker";
import { BedPicker } from "./BedPicker";

export function AdmissionForm({ initialPatient, initialDoctor, wards, initialWardId, initialBedId, openAdmission: initialOpen, today }) {
  const router = useRouter();
  const [patient, setPatient] = useState(initialPatient || null);
  const [doctor, setDoctor] = useState(initialDoctor || null);
  const [openAdmission, setOpenAdmission] = useState(initialOpen || null);
  const [bedRefresh, setBedRefresh] = useState(0);
  const form = useForm({
    resolver: zodResolver(admissionSchema),
    defaultValues: {
      patientId: initialPatient?.id ?? "", doctorId: initialDoctor?.id ?? "", wardId: initialWardId ?? "", bedId: initialBedId ?? "",
      reason: "", expectedDischargeDate: "",
    },
  });
  const errors = form.formState.errors;
  const wardId = useWatch({ control: form.control, name: "wardId" });
  const bedId = useWatch({ control: form.control, name: "bedId" });

  async function submit(values) {
    try {
      const r = await api("/api/admissions", { method: "POST", body: values });
      toast.success(`Patient admitted — ${r.data.admissionNo}`);
      router.push(`/admissions/${r.data.id}`);
      router.refresh();
    } catch (e) {
      if (e.status === 409 && e.fields?.admissionId) setOpenAdmission({ id: e.fields.admissionId });
      if (e.status === 409 && e.fields?.bedId) { form.setValue("bedId", ""); setBedRefresh((n) => n + 1); }
      handleFormError(e, form);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>
      {openAdmission && (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-[13.5px]">
          <p className="font-semibold text-warning flex items-center gap-2"><AlertTriangle size={16} /> This patient is already admitted</p>
          <p className="text-muted mt-1">A patient can have only one active admission. <Link className="text-primary font-semibold hover:underline" href={`/admissions/${openAdmission.id}`}>Open the current admission{openAdmission.admissionNo ? ` (${openAdmission.admissionNo})` : ""}</Link> to transfer or discharge instead.</p>
        </div>
      )}
      <FormSection title="Patient & doctor">
        <div className="sm:col-span-2">
          <p className="field-label">Patient<span className="req" aria-hidden>*</span></p>
          <PatientSelector value={patient} invalid={!!errors.patientId} onChange={(p) => { setPatient(p); setOpenAdmission(null); form.setValue("patientId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted }); }} />
          {errors.patientId && <p className="field-error" role="alert">Select the patient to admit</p>}
        </div>
        <div className="sm:col-span-2">
          <p className="field-label">Admitting doctor<span className="req" aria-hidden>*</span></p>
          <DoctorSelector value={doctor} invalid={!!errors.doctorId} onChange={(d) => { setDoctor(d); form.setValue("doctorId", d?.id ?? "", { shouldValidate: form.formState.isSubmitted }); }} />
          {errors.doctorId && <p className="field-error" role="alert">{errors.doctorId.message}</p>}
        </div>
      </FormSection>

      <FormSection title="Bed" description="Only available beds are listed. The bed is claimed atomically when you submit.">
        <div className="sm:col-span-2">
          <BedPicker wards={wards} wardId={wardId} bedId={bedId} refreshKey={bedRefresh}
            onWardChange={(v) => form.setValue("wardId", v, { shouldValidate: form.formState.isSubmitted })}
            onBedChange={(v) => form.setValue("bedId", v, { shouldValidate: form.formState.isSubmitted })}
            wardError={errors.wardId?.message} bedError={errors.bedId?.message} />
        </div>
      </FormSection>

      <FormSection title="Admission details">
        <TextareaField form={form} name="reason" label="Reason for admission" required rows={3} className="sm:col-span-2" />
        <TextField form={form} name="expectedDischargeDate" type="date" label="Expected discharge" min={today} hint="Optional — used for bed planning." />
      </FormSection>

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button href="/admissions">Cancel</Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting} disabled={!!openAdmission}>Admit patient</Button>
      </div>
    </form>
  );
}
