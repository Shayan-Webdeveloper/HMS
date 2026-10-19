"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Send, HandCoins, Undo2, Ban, Printer, FileDown, ShieldCheck, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, SelectField, TextareaField } from "@/components/ui/Form";
import { mutate } from "@/components/ui/api-client";
import { paymentSchema, refundSchema, methodLabel } from "@/lib/validation/billing";
import { formatMoney, D } from "@/lib/utils/money";
import { ClaimCreateDialog } from "@/components/insurance/ClaimCreateDialog";

/** RFC 4122 v4 id; falls back to getRandomValues where randomUUID is unavailable (non-secure contexts). */
export function uuidv4() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function InvoiceActions({ invoice, perms, methods, currency, locale }) {
  const router = useRouter();
  const [dialog, setDialog] = useState(null);
  const money = (v) => formatMoney(v, currency, locale);
  const s = invoice.status;
  const netPaid = D(invoice.amountPaid).minus(invoice.amountRefunded);
  const canPay = perms.payment && ["ISSUED", "PARTIALLY_PAID"].includes(s) && D(invoice.balance).gt(0);
  const canRefund = perms.refund && ["PARTIALLY_PAID", "PAID"].includes(s) && netPaid.gt(0);
  const canVoid = perms.void && ["DRAFT", "ISSUED"].includes(s) && netPaid.lte(0);
  const canIssue = perms.create && s === "DRAFT";
  const canClaim = perms.claim && ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(s);
  const close = () => setDialog(null);

  return (
    <div className="flex flex-wrap gap-2">
      {canIssue && <Button variant="primary" icon={Send} onClick={() => setDialog("issue")} disabled={!invoice.itemCount}>Issue invoice</Button>}
      {canPay && <Button variant="primary" icon={HandCoins} onClick={() => setDialog("pay")}>Record payment</Button>}
      {canClaim && <Button icon={ShieldCheck} onClick={() => setDialog("claim")}>Insurance claim</Button>}
      {canRefund && <Button icon={Undo2} onClick={() => setDialog("refund")}>Refund</Button>}
      <Button icon={Printer} href={`/billing/${invoice.id}/print`}>Print</Button>
      <a className="btn btn-secondary" href={`/api/invoices/${invoice.id}/pdf`} download><FileDown size={15} aria-hidden /> PDF</a>
      {canVoid && <Button variant="ghost" icon={Ban} className="text-danger" onClick={() => setDialog("void")}>Void</Button>}

      <ConfirmDialog open={dialog === "issue"} onClose={close} tone="primary" title={`Issue ${invoice.invoiceNo}?`} confirmLabel="Issue invoice"
        message={`Items, discounts and tax are locked once issued. Total ${money(invoice.total)}. Corrections after issue require voiding (before payment) or refunds.`}
        onConfirm={async () => { try { await mutate(`/api/invoices/${invoice.id}/issue`, {}, { success: "Invoice issued" }); close(); router.refresh(); } catch {} }} />
      <ConfirmDialog open={dialog === "void"} onClose={close} requireReason title={`Void ${invoice.invoiceNo}?`} confirmLabel="Void invoice"
        message="The invoice is kept for audit but no longer counts as owed. Its charges become billable again on a new invoice. This cannot be undone."
        onConfirm={async (reason) => { try { await mutate(`/api/invoices/${invoice.id}/void`, { reason }, { success: "Invoice voided" }); close(); router.refresh(); } catch {} }} />
      {dialog === "pay" && <PaymentDialog invoice={invoice} methods={methods} money={money} onClose={close} />}
      {dialog === "refund" && <RefundDialog invoice={invoice} methods={methods} money={money} onClose={close} />}
      {dialog === "claim" && <ClaimCreateDialog invoiceId={invoice.id} currency={currency} locale={locale} onClose={close} />}
    </div>
  );
}

function PaymentDialog({ invoice, methods, money, onClose }) {
  const router = useRouter();
  // One idempotency key per dialog opening: retries/double-clicks cannot record the payment twice.
  const [idempotencyKey] = useState(() => uuidv4());
  const form = useForm({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: D(invoice.balance).toFixed(2), method: methods[0] ?? "", reference: "", idempotencyKey },
  });
  const method = useWatch({ control: form.control, name: "method" });
  async function submit(values) {
    try {
      const p = await mutate(`/api/invoices/${invoice.id}/payments`, { ...values, idempotencyKey }, { form });
      toast.success(p.duplicate ? `Payment already recorded — receipt ${p.receiptNo}` : `Payment recorded — receipt ${p.receiptNo}`, {
        action: { label: "Print receipt", onClick: () => router.push(`/billing/receipts/${p.id}/print`) },
      });
      onClose();
      router.refresh();
    } catch {}
  }
  return (
    <Modal open onClose={onClose} title="Record payment" description={`${invoice.invoiceNo} · outstanding ${money(invoice.balance)}`}
      footer={<><Button onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Record payment</Button></>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid grid-cols-1 sm:grid-cols-2 gap-4" noValidate>
        <TextField form={form} name="amount" label="Amount" required inputMode="decimal" hint={`Max ${money(invoice.balance)}`} />
        <SelectField form={form} name="method" label="Method" required options={methods.map((m) => ({ value: m, label: methodLabel(m) }))} />
        <TextField form={form} name="reference" label="Reference" className="sm:col-span-2" hint="Terminal slip no., bank transfer ref. (optional)" />
        {method === "CARD" && (
          <p className="sm:col-span-2 text-xs text-muted flex gap-1.5 items-start"><Info size={13} className="shrink-0 mt-0.5" aria-hidden />Card payments are taken on the card terminal; this system only records them (no online payment provider is configured).</p>
        )}
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
  );
}

function RefundDialog({ invoice, methods, money, onClose }) {
  const router = useRouter();
  const max = D(invoice.amountPaid).minus(invoice.amountRefunded);
  const form = useForm({ resolver: zodResolver(refundSchema), defaultValues: { amount: max.toFixed(2), method: methods[0] ?? "", reason: "" } });
  async function submit(values) {
    try { await mutate(`/api/invoices/${invoice.id}/refunds`, values, { form, success: "Refund recorded" }); onClose(); router.refresh(); } catch {}
  }
  return (
    <Modal open onClose={onClose} title="Refund payment" description={`${invoice.invoiceNo} · net paid ${money(max)}`}
      footer={<><Button onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button><Button variant="danger" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Record refund</Button></>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid grid-cols-1 sm:grid-cols-2 gap-4" noValidate>
        <TextField form={form} name="amount" label="Amount" required inputMode="decimal" hint={`Max ${money(max)}`} />
        <SelectField form={form} name="method" label="Refund method" required options={methods.map((m) => ({ value: m, label: methodLabel(m) }))} />
        <TextareaField form={form} name="reason" label="Reason" required className="sm:col-span-2" rows={3} />
        <p className="sm:col-span-2 text-xs text-muted">A partial refund re-opens that amount as outstanding balance. Refunding everything paid marks the invoice refunded. Refunds are permanent and audited.</p>
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
  );
}
