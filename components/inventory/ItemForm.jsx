"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { itemSchema, ITEM_CATEGORIES, humanize } from "@/lib/validation/inventory";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField, SelectField } from "@/components/ui/Form";

const defaults = (it) => ({
  code: it?.code ?? "", name: it?.name ?? "", category: it?.category ?? "CONSUMABLE", unit: it?.unit ?? "piece",
  reorderLevel: it?.reorderLevel ?? 10, unitCost: it?.unitCost ?? "", location: it?.location ?? "",
});

/** Create / edit a general inventory item (consumables, equipment, supplies — not medicines). */
export function ItemFormModal({ open, onClose, item }) {
  const router = useRouter();
  const editing = !!item;
  const form = useForm({ resolver: zodResolver(itemSchema), defaultValues: defaults(item) });
  async function onSubmit(values) {
    try {
      const r = await api(editing ? `/api/inventory/items/${item.id}` : "/api/inventory/items", { method: editing ? "PATCH" : "POST", body: values });
      toast.success(editing ? "Item updated" : `Item ${r.data.code} added`);
      onClose();
      if (!editing) form.reset(defaults());
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit ${item.name}` : "Add inventory item"}
      description={editing ? "Stock quantity changes only through receipts, issues and adjustments." : "Opening stock is added by receiving a purchase order or an adjustment."}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>{editing ? "Save changes" : "Add item"}</Button></>}>
      <form className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <TextField form={form} name="code" label="Code" required autoComplete="off" hint="Unique, e.g. GLV-M" style={{ textTransform: "uppercase" }} />
        <SelectField form={form} name="category" label="Category" required options={ITEM_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))} />
        <TextField form={form} name="name" label="Name" required className="sm:col-span-2" />
        <TextField form={form} name="unit" label="Unit" required placeholder="piece, box, pack…" />
        <TextField form={form} name="location" label="Location" placeholder="e.g. Central store" />
        <TextField form={form} name="unitCost" label="Unit cost" required inputMode="decimal" placeholder="0.00" hint="Updated automatically when a purchase order is received" />
        <TextField form={form} name="reorderLevel" label="Reorder level" required type="number" inputMode="numeric" min={0} />
      </form>
    </Modal>
  );
}

export function AddItemButton({ variant = "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon={Plus} onClick={() => setOpen(true)}>Add item</Button>
      {open && <ItemFormModal open onClose={() => setOpen(false)} />}
    </>
  );
}

export function EditItemButton({ item, size = "md", variant = "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} icon={Pencil} onClick={() => setOpen(true)} aria-label={`Edit ${item.name}`}>Edit</Button>
      {open && <ItemFormModal open onClose={() => setOpen(false)} item={item} />}
    </>
  );
}
