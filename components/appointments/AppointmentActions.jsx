"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CheckCircle2, LogIn, Stethoscope, CalendarClock, XCircle, UserX, Pencil, ClipboardCheck, FileText, CalendarPlus } from "lucide-react";
import { actionsFor, appointmentUpdateSchema, BOOKABLE_TYPES, typeLabel, TERMINAL_STATUSES } from "@/lib/validation/appointments";
import { api, mutate, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField, Input, SelectField, TextField, TextareaField } from "@/components/ui/Form";
import { SlotPicker } from "./SlotPicker";

export function AppointmentActions({ appt, perms, currency, today }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null); // "cancel" | "no-show" | "reschedule" | "edit"
  const allowed = actionsFor(appt.status);
  const has = (a) => allowed.includes(a);

  async function run(action, body, success) {
    setBusy(action);
    try {
      const data = await mutate(`/api/appointments/${appt.id}/${action}`, body, { success });
      return data;
    } catch { return null; } finally { setBusy(null); }
  }

  async function checkIn() {
    const d = await run("check-in", undefined);
    if (d) { toast.success(`Checked in — token #${d.queueEntry?.tokenNumber}`); router.refresh(); }
  }
  async function start() {
    const d = await run("start", undefined, "Consultation started");
    if (d) router.push(`/consultations/${d.encounterId}`);
  }

  const terminal = TERMINAL_STATUSES.includes(appt.status);
  return (
    <div className="flex flex-wrap gap-2">
      {has("start") && perms.start && <Button variant="primary" icon={Stethoscope} loading={busy === "start"} onClick={start}>Start consultation</Button>}
      {appt.encounter && perms.clinical && <Button variant={appt.status === "IN_PROGRESS" ? "primary" : "secondary"} icon={FileText} href={`/consultations/${appt.encounter.id}`}>{appt.encounter.status === "DRAFT" ? "Open consultation" : "View consultation"}</Button>}
      {has("check-in") && perms.update && (
        <Button variant="primary" icon={LogIn} loading={busy === "check-in"} onClick={checkIn} disabled={!appt.isToday} title={appt.isToday ? undefined : "Check-in is only possible on the appointment day"}>Check in</Button>
      )}
      {has("confirm") && perms.update && <Button icon={CheckCircle2} loading={busy === "confirm"} onClick={async () => { if (await run("confirm", undefined, "Appointment confirmed")) router.refresh(); }}>Confirm</Button>}
      {has("complete") && perms.update && appt.encounter?.status === "FINALIZED" && <Button variant="success" icon={ClipboardCheck} loading={busy === "complete"} onClick={async () => { if (await run("complete", undefined, "Appointment completed")) router.refresh(); }}>Mark completed</Button>}
      {has("reschedule") && perms.update && <Button icon={CalendarClock} onClick={() => setDialog("reschedule")}>Reschedule</Button>}
      {!terminal && perms.update && <Button icon={Pencil} onClick={() => setDialog("edit")}>Edit details</Button>}
      {has("no-show") && perms.update && appt.isPast && <Button icon={UserX} onClick={() => setDialog("no-show")}>No-show</Button>}
      {has("cancel") && perms.cancel && <Button variant="danger" icon={XCircle} onClick={() => setDialog("cancel")}>Cancel</Button>}
      {appt.status === "COMPLETED" && perms.create && <Button icon={CalendarPlus} href={`/appointments/new?patientId=${appt.patientId}&doctorId=${appt.doctorId}&type=FOLLOW_UP`}>Book follow-up</Button>}

      <ConfirmDialog open={dialog === "cancel"} onClose={() => setDialog(null)} requireReason title={`Cancel ${appt.appointmentNo}?`}
        message={appt.status === "CHECKED_IN" ? "The patient will be removed from today's queue. This cannot be undone." : "The slot is released for other patients. This cannot be undone."}
        confirmLabel="Cancel appointment"
        onConfirm={async (reason) => { if (await run("cancel", { reason }, "Appointment cancelled")) { setDialog(null); router.refresh(); } }} />
      <ConfirmDialog open={dialog === "no-show"} onClose={() => setDialog(null)} title="Mark as no-show?"
        message="Record that the patient did not attend. The slot is released and this cannot be undone." confirmLabel="Mark no-show"
        onConfirm={async () => { if (await run("no-show", undefined, "Marked as no-show")) { setDialog(null); router.refresh(); } }} />
      {dialog === "reschedule" && <RescheduleDialog appt={appt} today={today} onClose={() => setDialog(null)} />}
      {dialog === "edit" && <EditDialog appt={appt} canEditFee={perms.editFee} currency={currency} onClose={() => setDialog(null)} />}
    </div>
  );
}

function RescheduleDialog({ appt, today, onClose }) {
  const router = useRouter();
  const [date, setDate] = useState(appt.localDate >= today ? appt.localDate : today);
  const [time, setTimeState] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const setTime = useCallback((t) => setTimeState(t), []);

  async function save() {
    if (!time) { setError("Choose a new time slot."); return; }
    setBusy(true); setError(null);
    try {
      await api(`/api/appointments/${appt.id}/reschedule`, { method: "POST", body: { date, time, reason: reason || undefined } });
      toast.success(`Rescheduled to ${date} ${time}`);
      onClose(); router.refresh();
    } catch (e) {
      setError(e.message);
      if (e.status === 409 || e.status === 422) { setTimeState(null); setRefreshKey((k) => k + 1); }
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={`Reschedule ${appt.appointmentNo}`} description="Pick a new slot with the same doctor. The patient and doctor are notified."
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={busy} onClick={save} disabled={!time}>Reschedule{time ? ` to ${time}` : ""}</Button></>}>
      <div className="space-y-4">
        <FormField label="New date" required>
          {(a) => <Input {...a} type="date" min={today} value={date} onChange={(e) => { setDate(e.target.value); setTimeState(null); }} className="sm:max-w-[220px]" />}
        </FormField>
        <div>
          <p className="field-label">New time<span className="req" aria-hidden>*</span></p>
          <SlotPicker doctorId={appt.doctorId} date={date} value={time} onChange={setTime} refreshKey={refreshKey} currentStartsAt={appt.startsAt} />
        </div>
        <FormField label="Reason (optional)">
          {(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Patient requested a later time" />}
        </FormField>
        {error && <p role="alert" className="field-error text-[13px]">{error}</p>}
      </div>
    </Modal>
  );
}

function EditDialog({ appt, canEditFee, currency, onClose }) {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(appointmentUpdateSchema), defaultValues: { type: appt.type === "WALK_IN" ? undefined : appt.type, reason: appt.reason ?? "", notes: appt.notes ?? "", fee: appt.fee } });
  async function onSubmit(v) {
    try {
      const body = { reason: v.reason ?? "", notes: v.notes ?? "", ...(appt.type !== "WALK_IN" ? { type: v.type } : {}), ...(canEditFee ? { fee: v.fee } : {}) };
      await api(`/api/appointments/${appt.id}`, { method: "PATCH", body });
      toast.success("Appointment updated");
      onClose(); router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  return (
    <Modal open onClose={onClose} title={`Edit ${appt.appointmentNo}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Save changes</Button></>}>
      <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {appt.type !== "WALK_IN" && <SelectField form={form} name="type" label="Visit type" options={BOOKABLE_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))} />}
        <TextField form={form} name="reason" label="Reason for visit" />
        <TextareaField form={form} name="notes" label="Front-desk notes" rows={3} />
        <TextField form={form} name="fee" label={`Fee (${currency})`} readOnly={!canEditFee} className={!canEditFee ? "[&_input]:bg-surface-2" : ""} hint={canEditFee ? "Fee changes are audited." : "Changing the fee requires the billing:discount permission."} />
      </form>
    </Modal>
  );
}
