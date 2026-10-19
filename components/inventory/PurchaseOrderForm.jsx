"use client";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderSchema, calcPoLine, calcPoTotal } from "@/lib/validation/inventory";
import { api, handleFormError } from "@/components/ui/api-client";
import { formatMoney } from "@/lib/utils/money";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Form";

const blankLine = { inventoryItemId: "", quantity: "", unitCost: "" };

function errAt(errors, path) {
  let e = errors;
  for (const p of path.split(".")) e = e?.[p];
  return e?.message;
}

/** Create or edit (DRAFT only) a purchase order with item lines; totals use Decimal math. */
export function PurchaseOrderForm({ suppliers, items, po, defaultSupplierId, currency = "PKR" }) {
  const router = useRouter();
  const editing = !!po?.id;
  const form = useForm({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      supplierId: po?.supplierId ?? defaultSupplierId ?? "",
      items: po?.items?.length ? po.items.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: String(l.quantity), unitCost: l.unitCost })) : [{ ...blankLine }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const lines = useWatch({ control: form.control, name: "items" }) || [];
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const safe = (v) => (/^\d+(\.\d{1,2})?$/.test(String(v ?? "").trim()) ? String(v).trim() : "0");
  const total = calcPoTotal(lines.map((l) => ({ quantity: Number(l?.quantity) || 0, unitCost: safe(l?.unitCost) })));
  const errors = form.formState.errors;
  const arrayError = errors.items?.root?.message || errors.items?.message;

  async function onSubmit(values) {
    try {
      const r = await api(editing ? `/api/purchase-orders/${po.id}` : "/api/purchase-orders", { method: editing ? "PATCH" : "POST", body: values });
      toast.success(editing ? "Purchase order updated" : `Draft ${r.data.poNumber} created`);
      router.push(`/inventory/purchase-orders/${r.data.id}`);
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <div className="grid sm:grid-cols-2 gap-4">
        <SelectField form={form} name="supplierId" label="Supplier" required placeholder="Choose supplier…" options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          hint={suppliers.length ? "Only active suppliers are listed" : "No active suppliers — add one under the Suppliers tab first."} />
      </div>

      <fieldset className="border-0 p-0 m-0">
        <legend className="text-[13px] font-semibold text-ink mb-2">Order lines</legend>
        <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_110px_140px_130px_36px] gap-2 px-1 pb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          <span>Item</span><span className="text-right">Quantity</span><span className="text-right">Unit cost</span><span className="text-right">Line total</span><span />
        </div>
        <ul className="space-y-2">
          {fields.map((f, i) => {
            const itemReg = form.register(`items.${i}.inventoryItemId`);
            const line = lines[i] || {};
            const unit = byId[line.inventoryItemId]?.unit;
            const eItem = errAt(errors, `items.${i}.inventoryItemId`), eQty = errAt(errors, `items.${i}.quantity`), eCost = errAt(errors, `items.${i}.unitCost`);
            return (
              <li key={f.id} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_110px_140px_130px_36px] gap-2 items-start rounded-lg border border-border sm:border-0 p-3 sm:p-1">
                <div className="col-span-2 sm:col-span-1">
                  <label className="sr-only" htmlFor={`po-item-${i}`}>Item for line {i + 1}</label>
                  <select id={`po-item-${i}`} className="select" aria-invalid={eItem ? true : undefined} {...itemReg}
                    onChange={(e) => {
                      itemReg.onChange(e);
                      const it = byId[e.target.value];
                      if (it && !form.getValues(`items.${i}.unitCost`)) form.setValue(`items.${i}.unitCost`, it.unitCost);
                    }}>
                    <option value="">Choose item…</option>
                    {items.map((it) => <option key={it.id} value={it.id}>{it.code} — {it.name}</option>)}
                  </select>
                  {eItem && <p className="field-error" role="alert">{eItem}</p>}
                </div>
                <div>
                  <label className="sm:sr-only field-label" htmlFor={`po-qty-${i}`}>Quantity{unit ? ` (${unit})` : ""}</label>
                  <input id={`po-qty-${i}`} type="number" inputMode="numeric" min={1} className="input text-right tabular" aria-invalid={eQty ? true : undefined} {...form.register(`items.${i}.quantity`)} />
                  {eQty && <p className="field-error" role="alert">{eQty}</p>}
                </div>
                <div>
                  <label className="sm:sr-only field-label" htmlFor={`po-cost-${i}`}>Unit cost</label>
                  <input id={`po-cost-${i}`} inputMode="decimal" placeholder="0.00" className="input text-right tabular" aria-invalid={eCost ? true : undefined} {...form.register(`items.${i}.unitCost`)} />
                  {eCost && <p className="field-error" role="alert">{eCost}</p>}
                </div>
                <p className="h-[38px] flex items-center justify-start sm:justify-end font-semibold tabular text-[13.5px]">
                  <span className="sm:hidden text-muted font-normal mr-2">Line total</span>{formatMoney(calcPoLine({ quantity: Number(line.quantity) || 0, unitCost: safe(line.unitCost) }), currency)}
                </p>
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" iconOnly icon={Trash2} disabled={fields.length === 1} onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`} />
                </div>
              </li>
            );
          })}
        </ul>
        {arrayError && <p className="field-error mt-2" role="alert">{arrayError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <Button size="sm" icon={Plus} onClick={() => append({ ...blankLine })} disabled={fields.length >= 100}>Add line</Button>
          <p className="text-[14px]">Total <span className="font-bold tabular text-[16px] ml-2">{formatMoney(total, currency)}</span></p>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button href={editing ? `/inventory/purchase-orders/${po.id}` : "/inventory?tab=purchase-orders"}>Cancel</Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>{editing ? "Save draft" : "Create draft"}</Button>
      </div>
    </form>
  );
}
