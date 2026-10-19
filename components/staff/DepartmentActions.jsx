"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Pencil, Power, PowerOff } from "lucide-react";
import { departmentSchema } from "@/lib/validation/staff";
import { api, mutate, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, TextareaField, CheckboxField } from "@/components/ui/Form";

export function NewDepartmentButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>New department</Button>
      {open && <DepartmentModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function DepartmentRowActions({ department }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const deactivate = department.isActive;
  return (
    <div className="flex gap-1.5 justify-end">
      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(true)} aria-label={`Edit ${department.name}`}>Edit</Button>
      <Button size="sm" variant="ghost" icon={deactivate ? PowerOff : Power} onClick={() => setToggling(true)} className={deactivate ? "text-danger" : "text-success"}>
        {deactivate ? "Deactivate" : "Activate"}
      </Button>
      {editing && <DepartmentModal department={department} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={toggling} onClose={() => setToggling(false)} requireReason={deactivate} tone={deactivate ? "danger" : "primary"}
        title={deactivate ? `Deactivate ${department.name}?` : `Activate ${department.name}?`}
        message={deactivate
          ? "Inactive departments are hidden from pickers (booking, staff and doctor forms). Existing records keep their department. Deactivation is blocked while active doctors belong to it."
          : "The department will be available in pickers again."}
        confirmLabel={deactivate ? "Deactivate" : "Activate"}
        onConfirm={async (reason) => {
          try {
            await mutate(`/api/departments/${department.id}/status`, { isActive: !deactivate, reason: reason || undefined }, { success: deactivate ? "Department deactivated" : "Department activated" });
            setToggling(false);
            router.refresh();
          } catch { /* toast shown */ }
        }} />
    </div>
  );
}

function DepartmentModal({ department, onClose }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: department?.name ?? "", code: department?.code ?? "", description: department?.description ?? "", isClinical: department?.isClinical ?? true },
  });
  async function submit(values) {
    try {
      await api(department ? `/api/departments/${department.id}` : "/api/departments", { method: department ? "PATCH" : "POST", body: values });
      toast.success(department ? "Department updated" : "Department created");
      onClose();
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  return (
    <Modal open onClose={onClose} title={department ? `Edit ${department.name}` : "New department"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>{department ? "Save changes" : "Create department"}</Button></>}>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
        <div className="grid sm:grid-cols-[1fr_140px] gap-3">
          <TextField form={form} name="name" label="Name" required placeholder="e.g. Dermatology" />
          <TextField form={form} name="code" label="Code" required placeholder="DERM" hint="Unique, 2–12 chars" autoComplete="off" />
        </div>
        <TextareaField form={form} name="description" label="Description" rows={2} maxLength={500} />
        <CheckboxField form={form} name="isClinical" label="Clinical department (sees patients)" />
        <button type="submit" className="sr-only">Save</button>
      </form>
    </Modal>
  );
}
