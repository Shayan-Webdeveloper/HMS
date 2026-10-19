"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { leaveSchema, LEAVE_TYPES, enumOptions, leaveDayCount } from "@/lib/validation/staff";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { FormField, TextField, SelectField, TextareaField } from "@/components/ui/Form";

const mapStaff = (s) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`, sub: [s.employeeNo, s.position, s.department?.name].filter(Boolean).join(" · ") });

export function NewLeaveButton({ staff, today, size = "md" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size={size} icon={CalendarPlus} onClick={() => setOpen(true)}>New leave request</Button>
      {open && <LeaveModal staff={staff} today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function LeaveModal({ staff, today, onClose }) {
  const router = useRouter();
  const [person, setPerson] = useState(staff ? { id: staff.id, label: staff.name, sub: staff.employeeNo } : null);
  const form = useForm({
    resolver: zodResolver(leaveSchema),
    defaultValues: { staffId: staff?.id ?? "", type: "ANNUAL", startDate: today, endDate: today, reason: "" },
  });
  const [start, end] = useWatch({ control: form.control, name: ["startDate", "endDate"] });
  const days = leaveDayCount(start || "", end || "");

  async function submit(values) {
    try {
      await api("/api/hr/leave", { method: "POST", body: values });
      toast.success("Leave request filed — HR managers have been notified");
      onClose();
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  const staffErr = form.formState.errors.staffId?.message;

  return (
    <Modal open onClose={onClose} title="New leave request" description="Filed on behalf of a staff member. HR managers are notified to decide."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Submit request</Button></>}>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
        <FormField label="Staff member" required error={staffErr}>
          {(a) => (
            <EntityPicker endpoint="/api/staff" mapItem={mapStaff} placeholder="Search name or employee no…" value={person} disabled={!!staff}
              id={a.id} invalid={!!staffErr} describedBy={a["aria-describedby"]}
              onChange={(v) => { setPerson(v); form.setValue("staffId", v?.id ?? "", { shouldValidate: !!v }); }} />
          )}
        </FormField>
        <SelectField form={form} name="type" label="Leave type" required options={enumOptions(LEAVE_TYPES)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField form={form} name="startDate" type="date" label="First day" required />
          <TextField form={form} name="endDate" type="date" label="Last day" required min={start || undefined} />
        </div>
        {days > 0 && <p className="text-[12.5px] text-muted -mt-2">{days} calendar day{days === 1 ? "" : "s"} (inclusive)</p>}
        <TextareaField form={form} name="reason" label="Reason / notes" rows={3} maxLength={500} hint="Visible to HR and staff managers only." />
        <button type="submit" className="sr-only">Submit</button>
      </form>
    </Modal>
  );
}
