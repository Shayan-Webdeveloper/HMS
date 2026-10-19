"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogOut } from "lucide-react";
import { dischargeSchema, DISCHARGE_CONDITIONS } from "@/lib/validation/inpatient";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SelectField, TextField, TextareaField, FormSection } from "@/components/ui/Form";

export function DischargeForm({ admissionId, admissionNo, bedLabel, defaultDate, defaultTime }) {
  const router = useRouter();
  const [pending, setPending] = useState(null);
  const form = useForm({ resolver: zodResolver(dischargeSchema), defaultValues: { dischargeSummary: "", dischargeCondition: "", dischargeDate: defaultDate, dischargeTime: defaultTime } });

  async function confirm() {
    try {
      await mutate(`/api/admissions/${admissionId}/discharge`, pending, { success: `${admissionNo} discharged`, form });
      setPending(null);
      router.replace(`/admissions/${admissionId}?tab=discharge`);
      router.refresh();
    } catch { setPending(null); }
  }

  return (
    <form className="space-y-5" onSubmit={form.handleSubmit((v) => setPending(v))} noValidate>
      <FormSection title="Discharge" description="Discharging ends the bed assignment, sends the bed for cleaning and notifies billing that bed charges are ready.">
        <TextareaField form={form} name="dischargeSummary" label="Discharge summary" required rows={8} className="sm:col-span-2"
          hint="Course in hospital, procedures, medications on discharge and follow-up instructions — written by the clinician." />
        <SelectField form={form} name="dischargeCondition" label="Condition at discharge" required placeholder="Select…" options={DISCHARGE_CONDITIONS.map((c) => ({ value: c, label: c }))} />
        <div className="grid grid-cols-2 gap-3">
          <TextField form={form} name="dischargeDate" type="date" label="Date" required />
          <TextField form={form} name="dischargeTime" type="time" label="Time" required />
        </div>
      </FormSection>
      <div className="flex justify-end pt-2 border-t border-border">
        <Button type="submit" variant="primary" icon={LogOut}>Discharge patient</Button>
      </div>
      <ConfirmDialog open={!!pending} onClose={() => setPending(null)} tone="primary" title={`Discharge ${admissionNo}?`}
        message={`The admission will be closed${bedLabel ? ` and bed ${bedLabel} sent for cleaning` : ""}. The discharge summary cannot be edited afterwards.`}
        confirmLabel="Confirm discharge" onConfirm={confirm} />
    </form>
  );
}
