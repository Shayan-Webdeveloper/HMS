"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Info } from "lucide-react";
import {
  hospitalSettingsSchema, appointmentPolicySchema, billingSettingsSchema, pharmacySettingsSchema, labSettingsSchema, emergencySettingsSchema,
  supportedTimeZones, PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
} from "@/lib/validation/settings";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { TextField, CheckboxField, FormSection } from "@/components/ui/Form";

function useSettingForm(schema, defaultValues, key, successMsg) {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(schema), defaultValues });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutate(`/api/settings/${key}`, values, { method: "PUT", success: successMsg, form });
      form.reset(values);
      router.refresh();
    } catch { /* toast + field errors handled by mutate */ }
  });
  return { form, onSubmit };
}

function SaveBar({ form, canEdit, updated }) {
  if (!canEdit) return <p className="text-xs text-muted flex items-center gap-1.5 pt-3 border-t border-border"><Info size={13} aria-hidden /> Read-only — changing settings requires the “Change hospital settings” permission.</p>;
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-border">
      {updated && <span className="text-xs text-subtle mr-auto">{updated}</span>}
      {form.formState.isDirty && <span className="text-xs text-warning font-medium">Unsaved changes</span>}
      <Button type="submit" variant="primary" icon={Save} loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>Save</Button>
    </div>
  );
}

export function HospitalProfileForm({ hospital, canEdit, updated }) {
  const zones = useMemo(() => supportedTimeZones(), []);
  const { form, onSubmit } = useSettingForm(hospitalSettingsSchema, {
    name: hospital.name ?? "", address: hospital.address ?? "", phone: hospital.phone ?? "", email: hospital.email ?? "",
    timezone: hospital.timezone, currency: hospital.currency, locale: hospital.locale,
  }, "hospital", "Hospital profile saved");
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <fieldset disabled={!canEdit} className="space-y-5">
        <FormSection title="Identity & contact" description="Shown in the application header, on invoices and printed documents.">
          <TextField form={form} name="name" label="Hospital name" required className="sm:col-span-2" />
          <TextField form={form} name="address" label="Address" className="sm:col-span-2" />
          <TextField form={form} name="phone" label="Phone" type="tel" />
          <TextField form={form} name="email" label="Email" type="email" />
        </FormSection>
        <FormSection title="Region" description="The time zone defines “today”, day boundaries in reports and appointment times. Changing it affects how existing times are displayed (they are stored in UTC).">
          <TextField form={form} name="timezone" label="Time zone (IANA)" required list="tz-options" autoComplete="off" hint="e.g. Asia/Karachi" />
          <datalist id="tz-options">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          <TextField form={form} name="currency" label="Currency (ISO 4217)" required maxLength={3} hint="3 letters, e.g. PKR" />
          <TextField form={form} name="locale" label="Locale (BCP 47)" required hint="Number/date formatting, e.g. en-PK" />
        </FormSection>
      </fieldset>
      <SaveBar form={form} canEdit={canEdit} updated={updated} />
    </form>
  );
}

export function AppointmentPolicyForm({ value, canEdit, updated }) {
  const { form, onSubmit } = useSettingForm(appointmentPolicySchema, {
    workdayStart: value.workdayStart, workdayEnd: value.workdayEnd, defaultSlotMinutes: value.defaultSlotMinutes,
    allowPatientRequests: !!value.allowPatientRequests, minCancelHours: value.minCancelHours,
  }, "appointments", "Appointment policy saved");
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        <FormSection>
          <TextField form={form} name="workdayStart" label="Workday starts" type="time" required />
          <TextField form={form} name="workdayEnd" label="Workday ends" type="time" required />
          <TextField form={form} name="defaultSlotMinutes" label="Default slot length (minutes)" type="number" min={5} max={120} required hint="Used for new doctors; each doctor can override it." />
          <TextField form={form} name="minCancelHours" label="Minimum notice for online cancellation (hours)" type="number" min={0} max={168} required hint="Patients cannot cancel confirmed appointments later than this in the portal." />
        </FormSection>
        <CheckboxField form={form} name="allowPatientRequests" label="Allow patients to request appointments from the portal" />
      </fieldset>
      <SaveBar form={form} canEdit={canEdit} updated={updated} />
    </form>
  );
}

export function BillingSettingsForm({ value, canEdit, updated }) {
  const { form, onSubmit } = useSettingForm(billingSettingsSchema, {
    taxRatePercent: String(value.taxRatePercent ?? "0"), paymentMethods: value.paymentMethods ?? ["CASH"], maxDiscountPercentWithoutApproval: value.maxDiscountPercentWithoutApproval ?? 10,
  }, "billing", "Billing settings saved");
  const methodsErr = form.formState.errors.paymentMethods?.message || form.formState.errors.paymentMethods?.root?.message;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-4">
        <FormSection>
          <TextField form={form} name="taxRatePercent" label="Default tax rate (%)" inputMode="decimal" required hint="0–100, up to 2 decimals. Applied to new invoice lines." />
          <TextField form={form} name="maxDiscountPercentWithoutApproval" label="Max discount without approval (%)" type="number" min={0} max={100} required />
        </FormSection>
        <div role="group" aria-labelledby="pm-label">
          <p id="pm-label" className="field-label">Accepted payment methods<span className="req">*</span></p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {PAYMENT_METHODS.map((m) => (
              <label key={m} className="inline-flex items-center gap-2 text-[13.5px] cursor-pointer">
                <input type="checkbox" className="checkbox" value={m} {...form.register("paymentMethods")} />{PAYMENT_METHOD_LABELS[m]}
              </label>
            ))}
          </div>
          {methodsErr && <p className="field-error" role="alert">{methodsErr}</p>}
          <p className="field-hint">“Online” only records payments taken through an external provider — no payment gateway is configured, so this system does not process online payments itself.</p>
        </div>
      </fieldset>
      <SaveBar form={form} canEdit={canEdit} updated={updated} />
    </form>
  );
}

export function PharmacySettingsForm({ value, canEdit, updated }) {
  const { form, onSubmit } = useSettingForm(pharmacySettingsSchema, { expiryAlertDays: value.expiryAlertDays }, "pharmacy", "Pharmacy settings saved");
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <fieldset disabled={!canEdit}>
        <TextField form={form} name="expiryAlertDays" label="Expiry alert window (days)" type="number" min={1} max={730} required hint="Batches expiring within this many days are flagged on dashboards and the expiry report." className="max-w-xs" />
      </fieldset>
      <SaveBar form={form} canEdit={canEdit} updated={updated} />
    </form>
  );
}

export function LabSettingsForm({ value, canEdit, updated }) {
  const { form, onSubmit } = useSettingForm(labSettingsSchema, { requireSecondValidator: !!value.requireSecondValidator }, "lab", "Laboratory settings saved");
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <fieldset disabled={!canEdit} className="space-y-1">
        <CheckboxField form={form} name="requireSecondValidator" label="Require a second person to validate results before release" />
        <p className="field-hint pl-6">When on, the technologist who entered a result cannot also validate it (four-eyes principle).</p>
      </fieldset>
      <SaveBar form={form} canEdit={canEdit} updated={updated} />
    </form>
  );
}

export function TriageEditor({ value, canEdit, updated }) {
  const { form, onSubmit } = useSettingForm(emergencySettingsSchema, { triageCategories: value.triageCategories ?? [] }, "emergency", "Triage categories saved");
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: "triageCategories" });
  const errs = form.formState.errors.triageCategories;
  const current = useWatch({ control: form.control, name: "triageCategories" }) ?? [];
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-[13px] text-muted">Categories are chosen by clinical staff when triaging — the system never assigns a category automatically. Keys already used on past visits should not be renamed.</p>
      <fieldset disabled={!canEdit} className="space-y-2">
        <div className="hidden sm:grid grid-cols-[120px_1fr_130px_auto] gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted px-1">
          <span>Key</span><span>Label</span><span>Colour</span><span className="sr-only">Actions</span>
        </div>
        {fields.map((f, i) => {
          const e = errs?.[i];
          const color = current[i]?.color;
          return (
            <div key={f.id} className="grid grid-cols-1 sm:grid-cols-[120px_1fr_130px_auto] gap-2 items-start rounded-lg border border-border p-2 sm:border-0 sm:p-0">
              <div>
                <input className="input font-mono uppercase" aria-label={`Key for category ${i + 1}`} aria-invalid={!!e?.key || undefined} {...form.register(`triageCategories.${i}.key`)} />
                {e?.key && <p className="field-error">{e.key.message}</p>}
              </div>
              <div>
                <input className="input" aria-label={`Label for category ${i + 1}`} aria-invalid={!!e?.label || undefined} {...form.register(`triageCategories.${i}.label`)} />
                {e?.label && <p className="field-error">{e.label.message}</p>}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <input type="color" className="h-[38px] w-[44px] rounded-md border border-border-strong bg-surface p-1 cursor-pointer" aria-label={`Colour picker for category ${i + 1}`} value={/^#[0-9a-f]{6}$/i.test(color || "") ? color : "#000000"} onChange={(ev) => form.setValue(`triageCategories.${i}.color`, ev.target.value, { shouldDirty: true, shouldValidate: true })} />
                  <input className="input font-mono text-[12.5px]" aria-label={`Colour hex for category ${i + 1}`} aria-invalid={!!e?.color || undefined} {...form.register(`triageCategories.${i}.color`)} />
                </div>
                {e?.color && <p className="field-error">{e.color.message}</p>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" iconOnly icon={ArrowUp} aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)} />
                <Button size="sm" variant="ghost" iconOnly icon={ArrowDown} aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, i + 1)} />
                <Button size="sm" variant="ghost" iconOnly icon={Trash2} aria-label="Remove category" disabled={fields.length <= 1} onClick={() => remove(i)} />
              </div>
            </div>
          );
        })}
        {(errs?.message || errs?.root?.message) && <p className="field-error" role="alert">{errs.message || errs.root.message}</p>}
        {canEdit && fields.length < 10 && <Button size="sm" icon={Plus} onClick={() => append({ key: "", label: "", color: "#64748b" })}>Add category</Button>}
      </fieldset>
      <SaveBar form={form} canEdit={canEdit} updated={updated} />
    </form>
  );
}
