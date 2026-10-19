"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PackageMinus } from "lucide-react";
import { issueSchema } from "@/lib/validation/inventory";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField, SelectField } from "@/components/ui/Form";

/** Issue stock from the store to a department (ISSUE movement). */
export function IssueItemButton({ item, departments, size = "sm", variant = "ghost" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(issueSchema), defaultValues: { departmentId: "", quantity: "", note: "" } });
  async function onSubmit(v) {
    if (v.quantity > item.quantity) { form.setError("quantity", { message: `Only ${item.quantity} ${item.unit} on hand` }); return; }
    try {
      await mutate(`/api/inventory/items/${item.id}/issue`, v, { success: `Issued ${v.quantity} ${item.unit}`, form });
      setOpen(false); form.reset(); router.refresh();
    } catch {}
  }
  return (
    <>
      <Button size={size} variant={variant} icon={PackageMinus} disabled={item.quantity <= 0 || !item.isActive} onClick={() => setOpen(true)} aria-label={`Issue ${item.name}`}
        title={item.quantity <= 0 ? "Out of stock" : !item.isActive ? "Inactive item" : undefined}>Issue</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Issue ${item.name}`} description={`${item.quantity} ${item.unit} on hand. The department is recorded on the ledger entry.`}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Issue stock</Button></>}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <SelectField form={form} name="departmentId" label="Department" required placeholder="Choose department…" className="sm:col-span-2" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          <TextField form={form} name="quantity" label={`Quantity (${item.unit})`} type="number" inputMode="numeric" min={1} max={item.quantity} required />
          <TextField form={form} name="note" label="Note" placeholder="e.g. Ward requisition #" />
        </form>
      </Modal>
    </>
  );
}
