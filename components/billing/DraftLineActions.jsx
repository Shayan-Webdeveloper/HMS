"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mutate } from "@/components/ui/api-client";
import { lineUpdateSchema } from "@/lib/validation/billing";
import { calcLine, formatMoney, D } from "@/lib/utils/money";

export function DraftLineActions({ invoiceId, item, canDiscount, canEdit, discountReason, maxDiscountPct, currency, locale }) {
  const router = useRouter();
  const [open, setOpen] = useState(null);
  if (!canEdit && !canDiscount) return null;
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" iconOnly icon={Pencil} onClick={() => setOpen("edit")} aria-label={`Edit discount or tax for ${item.description}`} title="Discount / tax" />
      {canEdit && <Button size="sm" variant="ghost" iconOnly icon={Trash2} className="text-danger" onClick={() => setOpen("remove")} aria-label={`Remove ${item.description}`} title="Remove line" />}
      {open === "edit" && <LineDialog invoiceId={invoiceId} item={item} canDiscount={canDiscount} canEdit={canEdit} discountReason={discountReason} maxDiscountPct={maxDiscountPct} currency={currency} locale={locale} onClose={() => setOpen(null)} />}
      <ConfirmDialog open={open === "remove"} onClose={() => setOpen(null)} title="Remove this line?" confirmLabel="Remove"
        message={`“${item.description}” will be removed from the draft. Charges from clinical records become available to bill again.`}
        onConfirm={async () => { try { await mutate(`/api/invoices/${invoiceId}/items/${item.id}`, undefined, { method: "DELETE", success: "Line removed" }); setOpen(null); router.refresh(); } catch {} }} />
    </div>
  );
}

function LineDialog({ invoiceId, item, canDiscount, canEdit, discountReason, maxDiscountPct, currency, locale, onClose }) {
  const router = useRouter();
  const money = (v) => formatMoney(v, currency, locale);
  const [discount, setDiscount] = useState(D(item.discount).toFixed(2));
  const [taxRate, setTaxRate] = useState(D(item.taxRate).toFixed(2));
  const [reason, setReason] = useState(discountReason || "");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const gross = D(item.unitPrice).mul(item.quantity);
  const preview = useMemo(() => {
    try { return calcLine({ quantity: item.quantity, unitPrice: item.unitPrice, discount: discount || 0, taxRate: taxRate || 0 }); } catch { return null; }
  }, [item, discount, taxRate]);
  const pct = gross.gt(0) && /^\d+(\.\d+)?$/.test(discount) ? D(discount).div(gross).mul(100) : D(0);

  async function save() {
    const body = {};
    if (canDiscount && !D(discount || 0).eq(item.discount)) { body.discount = discount; body.reason = reason; }
    if (canEdit && !D(taxRate || 0).eq(item.taxRate)) body.taxRate = taxRate;
    if (!Object.keys(body).length) { onClose(); return; }
    const parsed = lineUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const e = {};
      for (const i of parsed.error.issues) e[i.path[0]] ??= i.message;
      setErrors(e); return;
    }
    if (body.discount !== undefined && D(body.discount).gt(gross)) { setErrors({ discount: "Discount cannot exceed the line amount" }); return; }
    setBusy(true);
    try {
      await mutate(`/api/invoices/${invoiceId}/items/${item.id}`, parsed.data, { method: "PATCH" });
      toast.success("Line updated");
      onClose(); router.refresh();
    } catch (e) { if (e.fields) setErrors(e.fields); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Discount & tax" description={item.description}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save line</Button></>}>
      <div className="space-y-4">
        <dl className="grid grid-cols-3 gap-3 text-[13px] rounded-lg bg-surface-2 border border-border p-3">
          <div><dt className="text-xs text-muted">Qty × price</dt><dd className="tabular font-medium">{item.quantity} × {money(item.unitPrice)}</dd></div>
          <div><dt className="text-xs text-muted">Line amount</dt><dd className="tabular font-medium">{money(gross)}</dd></div>
          <div><dt className="text-xs text-muted">New total</dt><dd className="tabular font-semibold">{preview ? money(preview.lineTotal) : "—"}</dd></div>
        </dl>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="ln-disc">Discount amount</label>
            <input id="ln-disc" className="input tabular" inputMode="decimal" value={discount} disabled={!canDiscount} onChange={(e) => setDiscount(e.target.value)} aria-invalid={!!errors.discount} aria-describedby="ln-disc-h" />
            {errors.discount ? <p className="field-error" role="alert">{errors.discount}</p>
              : <p id="ln-disc-h" className="field-hint">{canDiscount ? `${pct.toFixed(1)}% of line${pct.gt(maxDiscountPct) ? ` · above the ${maxDiscountPct}% guideline — recorded in the audit log` : ""}` : "You do not have permission to apply discounts."}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="ln-tax">Tax rate (%)</label>
            <input id="ln-tax" className="input tabular" inputMode="decimal" value={taxRate} disabled={!canEdit} onChange={(e) => setTaxRate(e.target.value)} aria-invalid={!!errors.taxRate} />
            {errors.taxRate && <p className="field-error" role="alert">{errors.taxRate}</p>}
          </div>
        </div>
        {canDiscount && (
          <div>
            <label className="field-label" htmlFor="ln-reason">Discount reason{D(discount || 0).gt(0) && <span className="req">*</span>}</label>
            <textarea id="ln-reason" className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason} placeholder="e.g. Staff family concession approved by administrator" />
            {errors.reason ? <p className="field-error" role="alert">{errors.reason}</p> : <p className="field-hint">Saved on the invoice and in the audit trail.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
