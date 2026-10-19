"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { patientSchema, SEX, BLOOD_GROUPS } from "@/lib/validation/patients";
import { api, handleFormError } from "@/components/ui/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { TextField, SelectField, TextareaField, CheckboxField, FormSection } from "@/components/ui/Form";

const label = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export function PatientForm({ patient }) {
  const router = useRouter();
  const [dups, setDups] = useState(null);
  const ec = patient?.emergencyContacts?.[0];
  const form = useForm({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      firstName: patient?.firstName ?? "", lastName: patient?.lastName ?? "",
      dateOfBirth: patient?.dateOfBirth ? patient.dateOfBirth.slice(0, 10) : "", sex: patient?.sex ?? "UNKNOWN",
      phone: patient?.phone ?? "", email: patient?.email ?? "", address: patient?.address ?? "", city: patient?.city ?? "",
      bloodGroup: patient?.bloodGroup ?? "", medicalAlerts: patient?.medicalAlerts ?? "",
      consentToSms: patient?.consentToSms ?? false, consentToEmail: patient?.consentToEmail ?? false,
      emergencyContactName: ec?.name ?? "", emergencyContactRelationship: ec?.relationship ?? "", emergencyContactPhone: ec?.phone ?? "",
    },
  });

  async function submit(values, confirmDuplicate = false) {
    try {
      const r = await api(patient ? `/api/patients/${patient.id}` : "/api/patients", { method: patient ? "PATCH" : "POST", body: { ...values, confirmDuplicate } });
      toast.success(patient ? "Patient updated" : `Patient registered — ${r.data.mrn}`);
      router.push(`/patients/${r.data.id}`);
      router.refresh();
    } catch (e) {
      if (e.status === 409 && e.fields?.duplicates) { setDups(e.fields.duplicates); return; }
      handleFormError(e, form);
    }
  }

  return (
    <form onSubmit={form.handleSubmit((v) => submit(v))} className="space-y-6" noValidate>
      {dups && (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-4">
          <p className="font-semibold text-warning flex items-center gap-2"><AlertTriangle size={16} /> Possible duplicate patient</p>
          <p className="text-[13px] text-muted mt-1">These existing records look similar. Open one instead, or confirm this is a different person.</p>
          <ul className="mt-2 space-y-1 text-[13.5px]">
            {dups.map((d) => <li key={d.id}><Link className="text-primary font-semibold hover:underline" href={`/patients/${d.id}`}>{d.mrn}</Link> — {d.firstName} {d.lastName}{d.dateOfBirth ? `, born ${d.dateOfBirth.slice(0, 10)}` : ""}{d.phone ? `, ${d.phone}` : ""}</li>)}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit((v) => submit(v, true))}>Register as new patient</Button>
            <Button size="sm" onClick={() => setDups(null)}>Edit details</Button>
          </div>
        </div>
      )}
      <FormSection title="Identity" description="Only the name is required; collect other details as the workflow needs them.">
        <TextField form={form} name="firstName" label="First name" required autoComplete="off" />
        <TextField form={form} name="lastName" label="Last name" required autoComplete="off" />
        <TextField form={form} name="dateOfBirth" type="date" label="Date of birth" />
        <SelectField form={form} name="sex" label="Sex" options={SEX.map((s) => ({ value: s, label: label(s) }))} />
      </FormSection>
      <FormSection title="Contact">
        <TextField form={form} name="phone" label="Phone" type="tel" placeholder="+92 300 1234567" />
        <TextField form={form} name="email" label="Email" type="email" />
        <TextField form={form} name="address" label="Address" className="sm:col-span-2" />
        <TextField form={form} name="city" label="City" />
      </FormSection>
      <FormSection title="Clinical alerts">
        <SelectField form={form} name="bloodGroup" label="Blood group" placeholder="Unknown" options={BLOOD_GROUPS.map((b) => ({ value: b, label: b }))} />
        <TextareaField form={form} name="medicalAlerts" label="Medical alerts" hint="Shown prominently on the patient banner." className="sm:col-span-2" rows={2} />
      </FormSection>
      <FormSection title="Emergency contact">
        <TextField form={form} name="emergencyContactName" label="Name" />
        <TextField form={form} name="emergencyContactRelationship" label="Relationship" />
        <TextField form={form} name="emergencyContactPhone" label="Phone" type="tel" />
      </FormSection>
      <FormSection title="Communication consent">
        <CheckboxField form={form} name="consentToSms" label="Consents to SMS reminders" />
        <CheckboxField form={form} name="consentToEmail" label="Consents to email notifications" />
      </FormSection>
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button href={patient ? `/patients/${patient.id}` : "/patients"}>Cancel</Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>{patient ? "Save changes" : "Register patient"}</Button>
      </div>
    </form>
  );
}
