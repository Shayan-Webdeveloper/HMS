"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Power, PowerOff } from "lucide-react";
import { labTestSchema } from "@/lib/validation/lab";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, FormSection } from "@/components/ui/Form";

const str = (v) => (v == null ? "" : String(v));
const trimDec = (v) => (v == null || v === "" ? "" : String(v).includes(".") ? String(v).replace(/0+$/, "").replace(/\.$/, "") : String(v));

export function NewLabTestButton({ facets }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>Add test</Button>
      {open && <LabTestModal facets={facets} onClose={() => setOpen(false)} />}
    </>
  );
}

export function LabTestRowActions({ test, facets }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [toggle, setToggle] = useState(false);
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(true)} aria-label={`Edit ${test.name}`}>Edit</Button>
      <Button size="sm" variant="ghost" icon={test.isActive ? PowerOff : Power} onClick={() => setToggle(true)}>{test.isActive ? "Deactivate" : "Activate"}</Button>
      {edit && <LabTestModal facets={facets} test={test} onClose={() => setEdit(false)} />}
      <ConfirmDialog open={toggle} onClose={() => setToggle(false)} tone={test.isActive ? "danger" : "primary"}
        title={test.isActive ? `Deactivate ${test.code}?` : `Activate ${test.code}?`}
        message={test.isActive
          ? "Clinicians will no longer be able to order this test. Existing orders and results are not affected."
          : "The test becomes orderable again."}
        confirmLabel={test.isActive ? "Deactivate" : "Activate"}
        onConfirm={async () => {
          try {
            await mutate(`/api/lab/tests/${test.id}/active`, { isActive: !test.isActive }, { success: test.isActive ? "Test deactivated" : "Test activated" });
            setToggle(false); router.refresh();
          } catch { /* toast shown */ }
        }} />
    </div>
  );
}

function LabTestModal({ test, facets, onClose }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(labTestSchema),
    defaultValues: {
      code: str(test?.code), name: str(test?.name), category: str(test?.category), specimenType: str(test?.specimenType),
      unit: str(test?.unit), referenceLow: trimDec(test?.referenceLow), referenceHigh: trimDec(test?.referenceHigh), referenceText: str(test?.referenceText),
      price: test ? String(test.price) : "", turnaroundHours: test?.turnaroundHours ?? 24,
    },
  });
  async function submit(values) {
    try {
      await mutate(test ? `/api/lab/tests/${test.id}` : "/api/lab/tests", values, { method: test ? "PATCH" : "POST", success: test ? "Test updated" : "Test added", form });
      onClose(); router.refresh();
    } catch { /* field errors mapped */ }
  }
  const busy = form.formState.isSubmitting;
  return (
    <Modal open onClose={() => !busy && onClose()} size="lg" title={test ? `Edit ${test.code}` : "Add laboratory test"}
      description={test ? "Changes apply to new orders only. Existing orders keep the price and reference range captured when they were placed or resulted." : "Numeric results are flagged LOW/HIGH only against the low/high limits configured here."}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={form.handleSubmit(submit)}>{test ? "Save changes" : "Add test"}</Button></>}>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-6">
        <datalist id="lab-cats">{facets.categories.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="lab-specs">{facets.specimenTypes.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="lab-units">{facets.units.map((c) => <option key={c} value={c} />)}</datalist>
        <FormSection title="Test">
          <TextField form={form} name="code" label="Code" required placeholder="e.g. HB" hint="Unique; letters, digits, - or _" autoComplete="off" />
          <TextField form={form} name="name" label="Name" required />
          <TextField form={form} name="category" label="Category" required list="lab-cats" placeholder="e.g. Haematology" />
          <TextField form={form} name="specimenType" label="Specimen type" required list="lab-specs" placeholder="e.g. Serum" />
        </FormSection>
        <FormSection title="Reference range" description="Use low/high for numeric tests (either bound may be left blank). Use reference text for qualitative tests.">
          <TextField form={form} name="unit" label="Unit" list="lab-units" placeholder="e.g. mg/dL" />
          <div className="grid grid-cols-2 gap-3">
            <TextField form={form} name="referenceLow" label="Low" inputMode="decimal" />
            <TextField form={form} name="referenceHigh" label="High" inputMode="decimal" />
          </div>
          <TextField form={form} name="referenceText" label="Reference text" placeholder="e.g. Negative" className="sm:col-span-2" />
        </FormSection>
        <FormSection title="Operations">
          <TextField form={form} name="price" label="Price" required inputMode="decimal" placeholder="0.00" />
          <TextField form={form} name="turnaroundHours" label="Turnaround (hours)" required type="number" min={1} max={720} />
        </FormSection>
      </form>
    </Modal>
  );
}
