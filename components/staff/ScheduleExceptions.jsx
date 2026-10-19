"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { exceptionSchema } from "@/lib/validation/staff";
import { api, mutate, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/time";

export function ScheduleExceptions({ doctorId, exceptions, tz, canEdit, today }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);

  return (
    <div>
      {canEdit && (
        <div className="px-4 py-3 border-b border-border flex justify-end">
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Block time / leave</Button>
        </div>
      )}
      {exceptions.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No upcoming exceptions" description="Leave, conferences or blocked time will appear here and are excluded from bookable slots." />
      ) : (
        <ul className="divide-y divide-border">
          {exceptions.map((x) => {
            return (
              <li key={x.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium tabular">
                    {formatDateTime(x.startsAt, tz)} <span className="text-subtle">→</span> {formatDateTime(x.endsAt, tz)}
                    {x.ongoing && <Badge tone="warning" className="ml-2">In effect</Badge>}
                  </p>
                  <p className="text-[13px] text-muted mt-0.5 break-words">{x.reason}</p>
                </div>
                {canEdit && <Button size="sm" variant="ghost" iconOnly icon={Trash2} onClick={() => setRemoving(x)} aria-label="Remove exception" />}
              </li>
            );
          })}
        </ul>
      )}
      {adding && <AddExceptionModal doctorId={doctorId} today={today} onClose={() => setAdding(false)} onDone={() => { setAdding(false); router.refresh(); }} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} tone="danger" title="Remove this exception?"
        message="The time becomes bookable again according to the weekly availability."
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await mutate(`/api/doctors/${doctorId}/exceptions/${removing.id}`, undefined, { method: "DELETE", success: "Exception removed" });
            setRemoving(null);
            router.refresh();
          } catch { /* toast shown */ }
        }} />
    </div>
  );
}

function AddExceptionModal({ doctorId, today, onClose, onDone }) {
  const form = useForm({
    resolver: zodResolver(exceptionSchema),
    defaultValues: { startDate: today, startTime: "09:00", endDate: today, endTime: "17:00", reason: "" },
  });
  async function submit(values) {
    try {
      const r = await api(`/api/doctors/${doctorId}/exceptions`, { method: "POST", body: values });
      toast.success("Time blocked");
      const n = r.data.conflictingAppointments;
      if (n > 0) toast.warning(`${n} booked appointment${n === 1 ? "" : "s"} fall inside this period. Front desk has been notified to reschedule.`, { duration: 8000 });
      onDone();
    } catch (e) { handleFormError(e, form); }
  }
  const fullDay = () => { form.setValue("startTime", "00:00"); form.setValue("endTime", "23:59"); };
  return (
    <Modal open onClose={onClose} title="Block time or record leave" description="Times are in hospital local time. Existing bookings are not cancelled automatically."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Save</Button></>}>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField form={form} name="startDate" type="date" label="From date" required />
          <TextField form={form} name="startTime" type="time" label="From time" required />
          <TextField form={form} name="endDate" type="date" label="To date" required />
          <TextField form={form} name="endTime" type="time" label="To time" required />
        </div>
        <Button size="sm" variant="ghost" onClick={fullDay}>Whole day(s)</Button>
        <TextField form={form} name="reason" label="Reason" required placeholder="e.g. Annual leave, conference, OT list" maxLength={200} />
        <button type="submit" className="sr-only">Save</button>
      </form>
    </Modal>
  );
}
