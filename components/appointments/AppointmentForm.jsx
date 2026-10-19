"use client";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, Lock } from "lucide-react";
import { appointmentCreateSchema, BOOKABLE_TYPES, typeLabel } from "@/lib/validation/appointments";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { FormField, Select, Input, TextField, TextareaField, SelectField } from "@/components/ui/Form";
import { PatientSelector } from "@/components/ui/EntityPicker";
import { SlotPicker } from "./SlotPicker";

export function AppointmentForm({ patient: initialPatient, doctors, departments, defaults = {}, canEditFee, currency, today }) {
  const router = useRouter();
  const [patient, setPatient] = useState(initialPatient || null);
  const initialDoctor = doctors.find((d) => d.id === defaults.doctorId);
  const [deptId, setDeptId] = useState(initialDoctor?.departmentId || "");
  const [refreshKey, setRefreshKey] = useState(0);
  const [conflictMsg, setConflictMsg] = useState(null);

  const form = useForm({
    resolver: zodResolver(appointmentCreateSchema),
    defaultValues: {
      patientId: initialPatient?.id ?? "", doctorId: initialDoctor?.id ?? "",
      date: defaults.date && defaults.date >= today ? defaults.date : today, time: "",
      type: BOOKABLE_TYPES.includes(defaults.type) ? defaults.type : "NEW",
      reason: "", notes: "", fee: initialDoctor?.consultationFee ?? "",
    },
  });
  const { control, setValue, formState } = form;
  const [doctorId, date, time] = useWatch({ control, name: ["doctorId", "date", "time"] });
  const doctor = doctors.find((d) => d.id === doctorId);
  const filteredDoctors = useMemo(() => (deptId ? doctors.filter((d) => d.departmentId === deptId) : doctors), [doctors, deptId]);
  const setTime = useCallback((t) => setValue("time", t ?? "", { shouldValidate: !!t, shouldDirty: true }), [setValue]);

  async function onSubmit(values) {
    setConflictMsg(null);
    try {
      const body = { ...values, fee: canEditFee ? values.fee : undefined };
      const r = await api("/api/appointments", { method: "POST", body });
      toast.success(`Appointment booked — ${r.data.appointmentNo}`);
      router.push(`/appointments/${r.data.id}`);
      router.refresh();
    } catch (e) {
      if (e.status === 409 || (e.status === 422 && e.code === "INVALID_STATE")) {
        setConflictMsg(e.message);
        if (["SLOT_TAKEN", "SCHEDULE_EXCEPTION", "OUTSIDE_AVAILABILITY", "PAST"].includes(e.fields?.code)) { setTime(null); setRefreshKey((k) => k + 1); }
        toast.error(e.message);
        return;
      }
      handleFormError(e, form);
    }
  }

  const err = formState.errors;
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {conflictMsg && (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-[13.5px] text-warning flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> <span><span className="font-semibold">Couldn't book:</span> {conflictMsg}</span>
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-[13px] font-semibold text-ink mb-1">Patient</legend>
        <FormField label="Patient" required error={err.patientId && "Choose a patient"}>
          {(a) => <PatientSelector id={a.id} invalid={!!err.patientId} describedBy={a["aria-describedby"]} value={patient} onChange={(p) => { setPatient(p); setValue("patientId", p?.id ?? "", { shouldValidate: !!p }); }} />}
        </FormField>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-semibold text-ink mb-1">Doctor &amp; time</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
          <FormField label="Department">
            {(a) => (
              <Select {...a} value={deptId} onChange={(e) => {
                setDeptId(e.target.value);
                if (doctor && e.target.value && doctor.departmentId !== e.target.value) { setValue("doctorId", ""); setTime(null); }
              }}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Doctor" required error={err.doctorId && "Choose a doctor"}>
            {(a) => (
              <Select {...a} value={doctorId} onChange={(e) => {
                const d = doctors.find((x) => x.id === e.target.value);
                setValue("doctorId", e.target.value, { shouldValidate: true });
                setValue("fee", d?.consultationFee ?? "");
                if (d && !deptId) setDeptId(d.departmentId);
                setTime(null);
              }}>
                <option value="">Select a doctor…</option>
                {filteredDoctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.name} — {d.specialty}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Date" required error={err.date?.message}>
            {(a) => <Input {...a} type="date" min={today} value={date} onChange={(e) => { setValue("date", e.target.value, { shouldValidate: true }); setTime(null); }} />}
          </FormField>
        </div>
        <div className="mt-4">
          <p className="field-label" id="slot-label">Time<span className="req" aria-hidden>*</span></p>
          <SlotPicker doctorId={doctorId} date={date} value={time || null} onChange={setTime} refreshKey={refreshKey} invalid={!!err.time} describedBy="slot-label" />
          {err.time && <p className="field-error" role="alert">Choose an available time slot</p>}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-semibold text-ink mb-1">Visit details</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <SelectField form={form} name="type" label="Visit type" options={BOOKABLE_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))} />
          <FormField label={`Consultation fee (${currency})`} error={err.fee?.message} hint={canEditFee ? "Defaults to the doctor's fee. Changes are audited." : "Set from the doctor's fee."}>
            {(a) => (
              <div className="relative">
                <Input {...a} {...form.register("fee")} inputMode="decimal" readOnly={!canEditFee} className={!canEditFee ? "bg-surface-2 pr-9" : ""} />
                {!canEditFee && <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" aria-label="Read-only" />}
              </div>
            )}
          </FormField>
          <TextField form={form} name="reason" label="Reason for visit" placeholder="e.g. Follow-up of blood pressure" className="sm:col-span-2" />
          <TextareaField form={form} name="notes" label="Front-desk notes" rows={2} className="sm:col-span-2" hint="Administrative notes only — visible to staff." />
        </div>
      </fieldset>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t border-border">
        <Button href="/appointments">Cancel</Button>
        <Button type="submit" variant="primary" loading={formState.isSubmitting}>Book appointment{time ? ` at ${time}` : ""}</Button>
      </div>
    </form>
  );
}
