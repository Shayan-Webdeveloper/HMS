"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, XCircle, Save } from "lucide-react";
import { appointmentRequestSchema, portalProfileSchema } from "@/lib/validation/portal";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, SelectField, TextareaField, CheckboxField, FormSection } from "@/components/ui/Form";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RequestAppointmentButton({ doctors, minDate, maxDate, enabled }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(appointmentRequestSchema), defaultValues: { doctorId: "", preferredDate: "", reason: "" } });
  const doctorId = useWatch({ control: form.control, name: "doctorId" });
  const doc = doctors.find((d) => d.id === doctorId);
  if (!enabled) return <p className="text-[13px] text-muted">Online requests are currently turned off — please call the hospital to book.</p>;

  async function submit(values) {
    try {
      await mutate("/api/portal/appointments", values, { success: "Request sent — the hospital will confirm a time", form });
      setOpen(false);
      form.reset();
      router.refresh();
    } catch { /* handled by mutate */ }
  }
  return (
    <>
      <Button variant="primary" icon={CalendarPlus} onClick={() => setOpen(true)}>Request appointment</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Request an appointment" description="Choose a doctor and a preferred date. The hospital will contact you to confirm the exact time."
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Send request</Button></>}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <SelectField form={form} name="doctorId" label="Doctor" required placeholder="Choose a doctor…"
            options={doctors.map((d) => ({ value: d.id, label: `${d.name} — ${d.specialty} (${d.department})` }))} />
          {doc && <p className="text-xs text-muted -mt-2">Holds clinic on {doc.weekdays.map((w) => WEEKDAYS[w]).join(", ")}.</p>}
          <TextField form={form} name="preferredDate" label="Preferred date" type="date" required min={minDate} max={maxDate} />
          <TextareaField form={form} name="reason" label="Reason for visit" required rows={3} maxLength={300} hint="A short description, e.g. “follow-up for blood pressure”." />
          <p className="text-xs text-muted">This is a request, not a confirmed booking. For urgent problems call the hospital or go to the emergency department.</p>
          <button type="submit" hidden />
        </form>
      </Modal>
    </>
  );
}

export function CancelAppointmentButton({ id, label }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger" icon={XCircle} onClick={() => setOpen(true)}>Cancel</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} requireReason title="Cancel this appointment?" confirmLabel="Cancel appointment"
        message={`${label}. This cannot be undone online — you would need to request a new appointment.`}
        onConfirm={async (reason) => {
          try { await mutate(`/api/portal/appointments/${id}/cancel`, { reason }, { success: "Appointment cancelled" }); setOpen(false); router.refresh(); } catch { /* handled */ }
        }} />
    </>
  );
}

export function PortalProfileForm({ profile }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(portalProfileSchema),
    defaultValues: { phone: profile.phone ?? "", email: profile.email ?? "", address: profile.address ?? "", city: profile.city ?? "", consentToSms: !!profile.consentToSms, consentToEmail: !!profile.consentToEmail },
  });
  async function submit(values) {
    try {
      await mutate("/api/portal/profile", values, { method: "PATCH", success: "Contact details saved", form });
      form.reset(values);
      router.refresh();
    } catch { /* handled */ }
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-5" noValidate>
      <FormSection title="Contact details" description="Used by the hospital to reach you about appointments and results.">
        <TextField form={form} name="phone" label="Phone" type="tel" autoComplete="tel" />
        <TextField form={form} name="email" label="Email" type="email" autoComplete="email" hint="Contact email only — your sign-in email is not changed." />
        <TextField form={form} name="address" label="Address" className="sm:col-span-2" autoComplete="street-address" />
        <TextField form={form} name="city" label="City" autoComplete="address-level2" />
      </FormSection>
      <FormSection title="Communication preferences">
        <CheckboxField form={form} name="consentToSms" label="Send me SMS reminders" />
        <CheckboxField form={form} name="consentToEmail" label="Send me email notifications" />
      </FormSection>
      <div className="flex justify-end pt-3 border-t border-border">
        <Button type="submit" variant="primary" icon={Save} loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>Save changes</Button>
      </div>
    </form>
  );
}
