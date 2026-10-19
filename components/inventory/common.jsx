"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Printer, Power, PowerOff, SlidersHorizontal } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, SelectField, TextareaField } from "@/components/ui/Form";
import { mutate } from "@/components/ui/api-client";

/** Print the current page (print CSS hides the app chrome and `.no-print` elements). */
export function PrintButton({ label = "Print" }) {
  return <Button variant="primary" icon={Printer} onClick={() => window.print()}>{label}</Button>;
}

/** Activate / deactivate a catalogue record through its audited `/active` endpoint. */
export function ActiveToggleButton({ endpoint, isActive, noun = "record", size = "md", deactivateMessage, activateMessage }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} icon={isActive ? PowerOff : Power} onClick={() => setOpen(true)}>{isActive ? "Deactivate" : "Activate"}</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} requireReason={isActive} tone={isActive ? "danger" : "primary"}
        title={isActive ? `Deactivate ${noun}?` : `Activate ${noun}?`}
        message={isActive ? (deactivateMessage || `The ${noun} will no longer be offered for new transactions. History is preserved and it can be reactivated.`) : (activateMessage || `The ${noun} will be available again.`)}
        confirmLabel={isActive ? "Deactivate" : "Activate"}
        onConfirm={async (reason) => {
          try {
            await mutate(endpoint, { isActive: !isActive, ...(reason ? { reason } : {}) }, { success: isActive ? `${capitalize(noun)} deactivated` : `${capitalize(noun)} activated` });
            setOpen(false);
            router.refresh();
          } catch {}
        }} />
    </>
  );
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const adjustSchema = z.object({
  direction: z.enum(["IN", "OUT"], { error: "Choose increase or decrease" }),
  quantity: z.coerce.number({ error: "Enter a quantity" }).int("Use a whole number").min(1, "Quantity must be at least 1").max(1_000_000, "Quantity is too large"),
  reason: z.string().trim().min(3, "Give a reason (min 3 characters)").max(300),
});

/**
 * +/- stock correction with a mandatory reason. Decreases are validated against `current`
 * client-side and enforced server-side with a conditional decrement.
 */
export function AdjustStockButton({ endpoint, current, unit = "units", label = "Adjust", size = "sm", subject, variant = "ghost" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(adjustSchema), defaultValues: { direction: "OUT", quantity: "", reason: "" } });
  const direction = useWatch({ control: form.control, name: "direction" });
  async function onSubmit(v) {
    if (v.direction === "OUT" && v.quantity > current) { form.setError("quantity", { message: `Only ${current} ${unit} on hand` }); return; }
    try {
      await mutate(endpoint, v, { success: "Stock adjusted", form });
      setOpen(false); form.reset(); router.refresh();
    } catch {}
  }
  return (
    <>
      <Button size={size} variant={variant} icon={SlidersHorizontal} onClick={() => setOpen(true)} aria-label={subject ? `Adjust stock of ${subject}` : undefined}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Adjust stock" description={`${subject ? `${subject} · ` : ""}Currently ${current} ${unit} on hand. Every adjustment is recorded in the ledger with your reason.`}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Save adjustment</Button></>}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <SelectField form={form} name="direction" label="Adjustment" required options={[{ value: "OUT", label: "Decrease (−)" }, { value: "IN", label: "Increase (+)" }]} />
          <TextField form={form} name="quantity" label="Quantity" type="number" inputMode="numeric" min={1} max={direction === "OUT" ? current : undefined} required />
          <TextareaField form={form} name="reason" label="Reason" required rows={2} className="sm:col-span-2" placeholder="e.g. Physical count correction, damaged in storage" />
        </form>
      </Modal>
    </>
  );
}
