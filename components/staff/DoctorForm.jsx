"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { doctorSchema, SHIFTS, enumOptions } from "@/lib/validation/staff";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { TextField, SelectField, CheckboxField, FormSection } from "@/components/ui/Form";
import { TempPasswordModal } from "./TempPasswordModal";

export function DoctorForm({ doctor, departments, canCreateAccount, today, currency = "PKR" }) {
  const router = useRouter();
  const [created, setCreated] = useState(null);
  const staff = doctor?.staff;
  const form = useForm({
    resolver: zodResolver(doctorSchema),
    defaultValues: {
      firstName: staff?.firstName ?? "", lastName: staff?.lastName ?? "",
      email: staff?.email ?? "", phone: staff?.phone ?? "",
      departmentId: doctor?.departmentId ?? "", position: staff?.position ?? "Consultant",
      joiningDate: staff?.joiningDate ? staff.joiningDate.slice(0, 10) : today, shift: staff?.shift ?? "",
      specialty: doctor?.specialty ?? "", qualifications: doctor?.qualifications ?? "", licenseNumber: doctor?.licenseNumber ?? "",
      consultationFee: doctor?.consultationFee ?? "", slotMinutes: doctor?.slotMinutes ?? 15,
      acceptsAppointments: doctor?.acceptsAppointments ?? true, createAccount: false,
    },
  });
  const wantsAccount = useWatch({ control: form.control, name: "createAccount" });
  // Inactive departments stay selectable only if the doctor is already in one.
  const deptOptions = departments.filter((d) => d.isActive || d.id === doctor?.departmentId).map((d) => ({ value: d.id, label: d.isActive ? d.name : `${d.name} (inactive)` }));

  async function submit(values) {
    try {
      const r = await api(doctor ? `/api/doctors/${doctor.id}` : "/api/doctors", { method: doctor ? "PATCH" : "POST", body: values });
      if (doctor) {
        toast.success("Doctor profile updated");
        router.push(`/doctors/${doctor.id}`);
        router.refresh();
        return;
      }
      toast.success(`Doctor added — ${r.data.employeeNo}`);
      if (r.data.account) { setCreated(r.data); return; }
      router.push(`/doctors/${r.data.id}`);
      router.refresh();
    } catch (e) {
      handleFormError(e, form);
    }
  }

  return (
    <>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>
        <FormSection title="Identity & contact">
          <TextField form={form} name="firstName" label="First name" required autoComplete="off" />
          <TextField form={form} name="lastName" label="Last name" required autoComplete="off" />
          <TextField form={form} name="email" label="Work email" type="email" hint={canCreateAccount && !doctor ? "Also used as the sign-in email if you create a login." : undefined} />
          <TextField form={form} name="phone" label="Phone" type="tel" placeholder="+92 300 1234567" />
        </FormSection>
        <FormSection title="Employment">
          <SelectField form={form} name="departmentId" label="Department" required placeholder="Select department…" options={deptOptions} />
          <TextField form={form} name="position" label="Position" required placeholder="e.g. Consultant Physician" />
          <TextField form={form} name="joiningDate" label="Joining date" type="date" required />
          <SelectField form={form} name="shift" label="Shift" placeholder="Not set" options={enumOptions(SHIFTS)} />
        </FormSection>
        <FormSection title="Clinical profile" description="Fee and slot length drive appointment booking and billing.">
          <TextField form={form} name="specialty" label="Specialty" required placeholder="e.g. Internal Medicine" />
          <TextField form={form} name="qualifications" label="Qualifications" placeholder="e.g. MBBS, FCPS" />
          <TextField form={form} name="licenseNumber" label="License number" required hint="Must be unique (e.g. PMDC registration)." autoComplete="off" />
          <TextField form={form} name="consultationFee" label={`Consultation fee (${currency})`} required inputMode="decimal" placeholder="0.00" />
          <TextField form={form} name="slotMinutes" label="Slot length (minutes)" type="number" min={5} max={120} step={5} required />
          <div className="flex items-end pb-2"><CheckboxField form={form} name="acceptsAppointments" label="Accepting new appointments" /></div>
        </FormSection>
        {!doctor && canCreateAccount && (
          <FormSection title="Login account" description="Optional. Creates a DOCTOR sign-in with a one-time temporary password.">
            <div className="sm:col-span-2 space-y-1">
              <CheckboxField form={form} name="createAccount" label="Create a login account for this doctor" />
              {wantsAccount && <p className="field-hint">The temporary password is shown once after saving. The doctor must change it at first sign-in.</p>}
            </div>
          </FormSection>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button href={doctor ? `/doctors/${doctor.id}` : "/doctors"}>Cancel</Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>{doctor ? "Save changes" : "Add doctor"}</Button>
        </div>
      </form>
      {created && (
        <TempPasswordModal open email={created.account.email} password={created.account.temporaryPassword}
          onClose={() => { const id = created.id; setCreated(null); router.push(`/doctors/${id}`); router.refresh(); }} />
      )}
    </>
  );
}
