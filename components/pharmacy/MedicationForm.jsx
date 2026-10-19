"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { medicationSchema, DOSAGE_FORMS, humanize } from "@/lib/validation/pharmacy";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField, SelectField } from "@/components/ui/Form";

function defaults(m) {
  return {
    code: m?.code ?? "", genericName: m?.genericName ?? "", brandName: m?.brandName ?? "", strength: m?.strength ?? "",
    dosageForm: m?.dosageForm ?? "TABLET", category: m?.category ?? "", manufacturer: m?.manufacturer ?? "", unit: m?.unit ?? "unit",
    sellingPrice: m?.sellingPrice ?? "", reorderLevel: m?.reorderLevel ?? 50,
  };
}

/** Create / edit a catalogue medicine. `medication` (serialized) switches to edit mode. */
export function MedicationFormModal({ open, onClose, medication, categories = [] }) {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(medicationSchema), defaultValues: defaults(medication) });
  const editing = !!medication;
  async function onSubmit(values) {
    try {
      const r = await api(editing ? `/api/pharmacy/medications/${medication.id}` : "/api/pharmacy/medications", { method: editing ? "PATCH" : "POST", body: values });
      toast.success(editing ? "Medication updated" : `Medication ${r.data.code} added`);
      onClose();
      if (!editing) { form.reset(defaults()); router.push(`/pharmacy/medications/${r.data.id}`); }
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  const listId = "pharmacy-categories";
  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit ${medication.genericName} ${medication.strength}` : "Add medication"}
      description="Catalogue details used by prescribers, dispensing and billing."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>{editing ? "Save changes" : "Add medication"}</Button></>}>
      <form className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <TextField form={form} name="code" label="Code" required hint="Unique, e.g. PCM500" autoComplete="off" style={{ textTransform: "uppercase" }} />
        <SelectField form={form} name="dosageForm" label="Dosage form" required options={DOSAGE_FORMS.map((f) => ({ value: f, label: humanize(f) }))} />
        <TextField form={form} name="genericName" label="Generic name" required autoComplete="off" />
        <TextField form={form} name="brandName" label="Brand name" autoComplete="off" />
        <TextField form={form} name="strength" label="Strength" required placeholder="e.g. 500 mg, 120 mg/5 mL" />
        <TextField form={form} name="unit" label="Dispensing unit" required placeholder="tablet, bottle, vial…" hint="Quantities are counted in this unit" />
        <TextField form={form} name="category" label="Category" list={listId} placeholder="e.g. Antibiotic" />
        <TextField form={form} name="manufacturer" label="Manufacturer" />
        <TextField form={form} name="sellingPrice" label="Selling price (per unit)" required inputMode="decimal" placeholder="0.00" />
        <TextField form={form} name="reorderLevel" label="Reorder level" required type="number" inputMode="numeric" min={0} hint="Low-stock alert at or below this on-hand quantity" />
        <datalist id={listId}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </form>
    </Modal>
  );
}

export function AddMedicationButton({ categories, variant = "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon={Plus} onClick={() => setOpen(true)}>Add medication</Button>
      {open && <MedicationFormModal open onClose={() => setOpen(false)} categories={categories} />}
    </>
  );
}

export function EditMedicationButton({ medication, categories, size = "md", variant = "secondary", label = "Edit" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} icon={Pencil} onClick={() => setOpen(true)} aria-label={`Edit ${medication.genericName} ${medication.strength}`}>{label}</Button>
      {open && <MedicationFormModal open onClose={() => setOpen(false)} medication={medication} categories={categories} />}
    </>
  );
}
