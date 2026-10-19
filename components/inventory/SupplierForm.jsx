"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supplierSchema } from "@/lib/validation/inventory";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField, TextareaField } from "@/components/ui/Form";

const defaults = (s) => ({ name: s?.name ?? "", phone: s?.phone ?? "", email: s?.email ?? "", address: s?.address ?? "" });

export function SupplierFormModal({ open, onClose, supplier }) {
  const router = useRouter();
  const editing = !!supplier;
  const form = useForm({ resolver: zodResolver(supplierSchema), defaultValues: defaults(supplier) });
  async function onSubmit(values) {
    try {
      const r = await api(editing ? `/api/suppliers/${supplier.id}` : "/api/suppliers", { method: editing ? "PATCH" : "POST", body: values });
      toast.success(editing ? "Supplier updated" : `Supplier ${r.data.name} added`);
      onClose();
      if (!editing) form.reset(defaults());
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${supplier.name}` : "Add supplier"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>{editing ? "Save changes" : "Add supplier"}</Button></>}>
      <form className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <TextField form={form} name="name" label="Supplier name" required className="sm:col-span-2" />
        <TextField form={form} name="phone" label="Phone" type="tel" />
        <TextField form={form} name="email" label="Email" type="email" />
        <TextareaField form={form} name="address" label="Address" rows={2} className="sm:col-span-2" />
      </form>
    </Modal>
  );
}

export function AddSupplierButton({ variant = "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon={Plus} onClick={() => setOpen(true)}>Add supplier</Button>
      {open && <SupplierFormModal open onClose={() => setOpen(false)} />}
    </>
  );
}

export function EditSupplierButton({ supplier, size = "md", variant = "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} icon={Pencil} onClick={() => setOpen(true)} aria-label={`Edit ${supplier.name}`}>Edit</Button>
      {open && <SupplierFormModal open onClose={() => setOpen(false)} supplier={supplier} />}
    </>
  );
}
