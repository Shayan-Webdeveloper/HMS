"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PackagePlus } from "lucide-react";
import { receiveBatchSchema } from "@/lib/validation/pharmacy";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField, SelectField, FormField } from "@/components/ui/Form";
import { EntityPicker } from "@/components/ui/EntityPicker";

const mapMedication = (m) => ({ id: m.id, label: `${m.genericName} ${m.strength}`, sub: [m.code, m.brandName, `${m.onHand} on hand`].filter(Boolean).join(" · "), raw: m });

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Receive a new batch. With `medication` the medicine is fixed; otherwise the user picks one
 * from the active catalogue (GET /api/pharmacy/medications).
 */
export function ReceiveStockButton({ medication, suppliers = [], variant = "primary", size = "md", label = "Receive stock" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const [pickErr, setPickErr] = useState("");
  const form = useForm({ resolver: zodResolver(receiveBatchSchema), defaultValues: { batchNo: "", expiryDate: "", quantity: "", purchaseCost: "", supplierId: "" } });
  const med = medication || picked?.raw || null;

  function close() { setOpen(false); setPickErr(""); }

  async function onSubmit(v) {
    if (!med) { setPickErr("Choose a medication"); return; }
    if (v.expiryDate <= localDate(0)) { form.setError("expiryDate", { message: "Expiry date must be in the future" }); return; }
    try {
      await mutate(`/api/pharmacy/medications/${med.id}/batches`, v, { success: `Batch ${v.batchNo} received`, form });
      form.reset(); setPicked(null); close(); router.refresh();
    } catch {}
  }

  return (
    <>
      <Button variant={variant} size={size} icon={PackagePlus} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={close} size="lg" title="Receive stock"
        description={medication ? `${medication.genericName} ${medication.strength} — a new batch is created and recorded in the ledger as a receipt.` : "Creates a new batch and records a receipt in the stock ledger."}
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Receive batch</Button></>}>
        <form className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          {!medication && (
            <FormField label="Medication" required error={pickErr} className="sm:col-span-2">
              {(a) => <EntityPicker id={a.id} describedBy={a["aria-describedby"]} invalid={!!pickErr} endpoint="/api/pharmacy/medications" mapItem={mapMedication} value={picked} onChange={(v) => { setPicked(v); setPickErr(""); }} placeholder="Search by name or code…" />}
            </FormField>
          )}
          <TextField form={form} name="batchNo" label="Batch number" required autoComplete="off" hint="Unique per medication" />
          <TextField form={form} name="expiryDate" label="Expiry date" type="date" required min={localDate(1)} />
          <TextField form={form} name="quantity" label={`Quantity${med?.unit ? ` (${med.unit})` : ""}`} type="number" inputMode="numeric" min={1} required />
          <TextField form={form} name="purchaseCost" label="Purchase cost (per unit)" inputMode="decimal" placeholder="0.00" required />
          <SelectField form={form} name="supplierId" label="Supplier" placeholder="Not recorded" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} className="sm:col-span-2"
            hint={suppliers.length ? undefined : "No active suppliers — add one under Inventory › Suppliers."} />
        </form>
      </Modal>
    </>
  );
}
