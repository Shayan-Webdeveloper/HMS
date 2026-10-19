"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, PackageCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { dispenseSchema, returnSchema, humanize } from "@/lib/validation/pharmacy";
import { api, mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SelectField, TextField, TextareaField } from "@/components/ui/Form";
import { formatDateOnly } from "@/lib/utils/time";

const initialQty = (it) => String(Math.max(0, Math.min(it.remaining, it.onHand)));

/**
 * Items table with per-item "dispense now" quantities. The server allocates FEFO across
 * non-expired batches in a single transaction; this component only collects quantities.
 */
export function DispensePanel({ prescriptionId, prescriptionNo, items, dispensable, canDispense, canReturn, returnable }) {
  const router = useRouter();
  const editable = dispensable && canDispense;
  const [qty, setQty] = useState(() => Object.fromEntries(items.map((it) => [it.id, editable ? initialQty(it) : "0"])));
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(false);

  const rows = useMemo(() => items.map((it) => {
    const raw = qty[it.id] ?? "0";
    const n = raw === "" ? 0 : Number(raw);
    let err = errors[it.id];
    if (!err && raw !== "" && (!Number.isInteger(n) || n < 0)) err = "Whole number ≥ 0";
    else if (!err && n > it.remaining) err = `Max ${it.remaining}`;
    return { ...it, n: Number.isFinite(n) ? n : 0, err, short: n > it.onHand };
  }), [items, qty, errors]);
  const toDispense = rows.filter((r) => r.n > 0);
  const totalUnits = toDispense.reduce((s, r) => s + r.n, 0);
  const hasErrors = rows.some((r) => r.err && r.remaining > 0);
  const blockedByStock = toDispense.some((r) => r.short);

  function setRow(id, v) {
    setQty((q) => ({ ...q, [id]: v }));
    setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
  }

  async function submit() {
    const payload = { items: toDispense.map((r) => ({ itemId: r.id, quantity: r.n })) };
    const parsed = dispenseSchema.safeParse(payload);
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message || "Check the quantities"); setConfirm(false); return; }
    try {
      const r = await api(`/api/pharmacy/prescriptions/${prescriptionId}/dispense`, { method: "POST", body: parsed.data });
      toast.success(`Dispensed ${r.data.dispensed} unit${r.data.dispensed === 1 ? "" : "s"} — ${humanize(r.data.status).toLowerCase()}`);
      if (r.data.lowStock?.length) toast.warning("Some medicines are now at or below their reorder level.");
      setConfirm(false);
      router.refresh();
    } catch (e) {
      setConfirm(false);
      const fe = {};
      for (const [k, msg] of Object.entries(e.fields || {})) {
        const m = /^items\.(\d+)\.quantity$/.exec(k);
        if (m && payload.items[Number(m[1])]) fe[payload.items[Number(m[1])].itemId] = msg;
      }
      setErrors(fe);
      toast.error(e.message || "Dispensing failed");
    }
  }

  return (
    <div>
      <div className="table-wrap">
        <table className="table table-responsive">
          <caption className="sr-only">Prescription items</caption>
          <thead>
            <tr>
              <th scope="col">Medicine</th>
              <th scope="col">Directions</th>
              <th scope="col" className="num">Prescribed</th>
              <th scope="col" className="num">Dispensed</th>
              <th scope="col" className="num">Remaining</th>
              <th scope="col" className="num">In stock</th>
              {editable && <th scope="col" className="num">Dispense now</th>}
              {canReturn && returnable && <th scope="col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Medicine">
                  <div className="text-left">
                    <p className="font-semibold">{r.medication.genericName} {r.medication.strength}</p>
                    <p className="text-xs text-muted">{[r.medication.brandName, humanize(r.medication.dosageForm), r.medication.code].filter(Boolean).join(" · ")}</p>
                  </div>
                </td>
                <td data-label="Directions">
                  <div className="text-left text-[13px]">
                    <p>{r.dose} · {r.route} · {r.frequency} · {r.durationDays} day{r.durationDays === 1 ? "" : "s"}</p>
                    {r.instructions && <p className="text-xs text-muted">{r.instructions}</p>}
                  </div>
                </td>
                <td data-label="Prescribed" className="num">{r.quantity}</td>
                <td data-label="Dispensed" className="num">{r.dispensedQty}</td>
                <td data-label="Remaining" className="num font-semibold">
                  {r.remaining === 0 ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={14} aria-hidden /> 0</span> : r.remaining}
                </td>
                <td data-label="In stock" className={`num ${r.onHand < r.remaining ? "text-danger font-semibold" : ""}`}>
                  {r.onHand} <span className="text-xs text-subtle font-normal">{r.medication.unit}</span>
                </td>
                {editable && (
                  <td data-label="Dispense now" className="num">
                    {r.remaining === 0 ? <span className="text-xs text-subtle">Complete</span> : (
                      <div className="flex flex-col items-end">
                        <label className="sr-only" htmlFor={`dq-${r.id}`}>Quantity to dispense for {r.medication.genericName}</label>
                        <input id={`dq-${r.id}`} type="number" inputMode="numeric" min={0} max={r.remaining} step={1} className="input w-24 text-right tabular"
                          value={qty[r.id]} onChange={(e) => setRow(r.id, e.target.value)} aria-invalid={r.err ? true : undefined} aria-describedby={r.err || r.short ? `dq-${r.id}-msg` : undefined} />
                        {r.err ? <p id={`dq-${r.id}-msg`} className="field-error" role="alert">{r.err}</p>
                          : r.short ? <p id={`dq-${r.id}-msg`} className="field-error">Only {r.onHand} in stock</p> : null}
                      </div>
                    )}
                  </td>
                )}
                {canReturn && returnable && (
                  <td data-label="">
                    {r.dispensedQty > 0 && r.returnBatches.length > 0 && <ReturnItemButton prescriptionId={prescriptionId} item={r} />}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-border bg-surface-2 rounded-b-xl">
          <p className="text-[13px] text-muted">
            {totalUnits > 0 ? <>Dispensing <span className="font-semibold text-ink tabular">{totalUnits}</span> unit{totalUnits === 1 ? "" : "s"} across <span className="font-semibold text-ink tabular">{toDispense.length}</span> item{toDispense.length === 1 ? "" : "s"}. Batches are picked first-expiry-first-out; expired stock is never used.</> : "Enter the quantities to hand over."}
          </p>
          <Button variant="primary" icon={PackageCheck} disabled={totalUnits === 0 || hasErrors || blockedByStock} onClick={() => setConfirm(true)}>Dispense</Button>
        </div>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="primary" title={`Dispense ${prescriptionNo}?`} confirmLabel="Confirm & dispense"
        message={`${totalUnits} unit${totalUnits === 1 ? "" : "s"} across ${toDispense.length} item${toDispense.length === 1 ? "" : "s"} will be deducted from stock and recorded against this prescription. Confirm you have checked the patient's identity and allergies.`}
        onConfirm={submit} />
    </div>
  );
}

function ReturnItemButton({ prescriptionId, item }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const single = item.returnBatches.length === 1 ? item.returnBatches[0].id : "";
  const form = useForm({ resolver: zodResolver(returnSchema), defaultValues: { itemId: item.id, batchId: single, quantity: "", reason: "" } });
  const batchId = useWatch({ control: form.control, name: "batchId" });
  const max = item.returnBatches.find((b) => b.id === batchId)?.max ?? item.dispensedQty;
  async function onSubmit(v) {
    if (v.quantity > max) { form.setError("quantity", { message: `At most ${max} can be returned to this batch` }); return; }
    try {
      await mutate(`/api/pharmacy/prescriptions/${prescriptionId}/return`, v, { success: "Return recorded", form });
      setOpen(false); form.reset({ itemId: item.id, batchId: single, quantity: "", reason: "" }); router.refresh();
    } catch {}
  }
  return (
    <>
      <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setOpen(true)} aria-label={`Return ${item.medication.genericName}`}>Return</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Return ${item.medication.genericName} ${item.medication.strength}`}
        description={`${item.dispensedQty} ${item.medication.unit} dispensed. Returned units go back into the chosen batch and the prescription status is recalculated.`}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Record return</Button></>}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <SelectField form={form} name="batchId" label="Return to batch" required placeholder={single ? undefined : "Choose batch…"} className="sm:col-span-2"
            options={item.returnBatches.map((b) => ({ value: b.id, label: `${b.batchNo} · exp. ${formatDateOnly(b.expiryDate)} · up to ${b.max}` }))} />
          <TextField form={form} name="quantity" label="Quantity" type="number" inputMode="numeric" min={1} max={max} required hint={`Up to ${max}`} />
          <div className="hidden sm:block" />
          <TextareaField form={form} name="reason" label="Reason" required rows={2} className="sm:col-span-2" placeholder="e.g. Unused, sealed packs returned by patient" />
        </form>
        <p className="mt-3 text-xs text-muted flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden /> Only return unopened stock that is fit to re-dispense.</p>
      </Modal>
    </>
  );
}
