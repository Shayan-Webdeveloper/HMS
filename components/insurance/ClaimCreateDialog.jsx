"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { api } from "@/components/ui/api-client";
import { claimCreateSchema } from "@/lib/validation/insurance";
import { formatMoney, D } from "@/lib/utils/money";
import { formatDateOnly } from "@/lib/utils/time";

/** Raise a claim for an issued/partially paid/paid invoice against an active policy of the same patient. */
export function ClaimCreateDialog({ invoiceId: fixedInvoiceId, currency, locale, onClose }) {
  const router = useRouter();
  const money = useCallback((v) => formatMoney(v, currency, locale), [currency, locale]);
  const mapInvoice = useCallback((i) => ({ id: i.id, label: `${i.invoiceNo} — ${i.patient.firstName} ${i.patient.lastName}`, sub: `${i.patient.mrn} · ${i.status.replace(/_/g, " ").toLowerCase()} · total ${money(i.total)}` }), [money]);
  const [invoice, setInvoice] = useState(fixedInvoiceId ? { id: fixedInvoiceId } : null);
  const [elig, setElig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [policyId, setPolicyId] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!invoice?.id) { setElig(null); return; }
    let cancelled = false;
    setLoading(true); setErrors({});
    api(`/api/insurance/claims/eligibility?invoiceId=${encodeURIComponent(invoice.id)}`)
      .then((r) => { if (cancelled) return; setElig(r.data); setPolicyId(r.data.policies[0]?.id ?? ""); setAmount(D(r.data.remaining).toFixed(2)); })
      .catch((e) => { if (!cancelled) { setElig(null); toast.error(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [invoice?.id]);

  async function submit() {
    const parsed = claimCreateSchema.safeParse({ invoiceId: invoice?.id, policyId, claimAmount: amount });
    if (!parsed.success) { const e = {}; for (const i of parsed.error.issues) e[i.path[0]] ??= i.message; setErrors(e); return; }
    if (elig && D(parsed.data.claimAmount).gt(elig.remaining)) { setErrors({ claimAmount: `At most ${money(elig.remaining)} can be claimed on this invoice.` }); return; }
    setBusy(true);
    try {
      const r = await api("/api/insurance/claims", { method: "POST", body: parsed.data });
      toast.success(`Claim ${r.data.claimNo} submitted`);
      onClose();
      router.push(`/insurance/claims/${r.data.id}`);
      router.refresh();
    } catch (e) { if (e.fields) setErrors(e.fields); toast.error(e.message); }
    finally { setBusy(false); }
  }

  const blocked = elig && (!elig.claimable || !elig.policies.length || D(elig.remaining).lte(0));
  return (
    <Modal open onClose={onClose} size="lg" title="New insurance claim" description="Manual claim tracking — submit the claim to the insurer outside this system, then record their decision here."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!elig || blocked} onClick={submit}>Submit claim</Button></>}>
      <div className="space-y-4">
        {!fixedInvoiceId && (
          <div>
            <label className="field-label" htmlFor="claim-inv">Invoice<span className="req">*</span></label>
            <EntityPicker id="claim-inv" endpoint="/api/invoices" extraQuery="&claimable=1" mapItem={mapInvoice} value={invoice?.label ? invoice : null} onChange={setInvoice} placeholder="Search invoice no., patient name or MRN…" invalid={!!errors.invoiceId} />
            <p className="field-hint">Issued, partially paid or paid invoices only.</p>
          </div>
        )}
        {loading && <p className="text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Checking policies…</p>}
        {elig && !loading && (
          <>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-surface-2 border border-border p-3 text-[13px]">
              <div><dt className="text-xs text-muted">Invoice</dt><dd className="font-mono font-medium">{elig.invoice.invoiceNo}</dd></div>
              <div><dt className="text-xs text-muted">Patient</dt><dd className="font-medium">{elig.invoice.patient.firstName} {elig.invoice.patient.lastName}</dd></div>
              <div><dt className="text-xs text-muted">Total</dt><dd className="tabular">{money(elig.invoice.total)}</dd></div>
              <div><dt className="text-xs text-muted">Still claimable</dt><dd className="tabular font-semibold">{money(elig.remaining)}</dd></div>
            </dl>
            {!elig.claimable && <Warn>This invoice is {elig.invoice.status.replace(/_/g, " ").toLowerCase()} — only issued, partially paid or paid invoices can be claimed.</Warn>}
            {elig.claimable && D(elig.remaining).lte(0) && <Warn>Existing claims already cover the full invoice total.</Warn>}
            {elig.claimable && !elig.policies.length && <Warn>No active policy of this patient covers the invoice date ({formatDateOnly(elig.invoice.date)}). Add or update a policy in the Policies tab first.</Warn>}
            {elig.policies.length > 0 && (
              <fieldset>
                <legend className="field-label">Policy<span className="req">*</span></legend>
                <div className="space-y-2">
                  {elig.policies.map((p) => (
                    <label key={p.id} className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${policyId === p.id ? "border-primary bg-primary-soft/40" : "border-border"}`}>
                      <input type="radio" name="policy" className="mt-1" checked={policyId === p.id} onChange={() => setPolicyId(p.id)} />
                      <span className="text-[13.5px]"><span className="font-medium">{p.provider}</span> · <span className="font-mono">{p.policyNumber}</span><br /><span className="text-xs text-muted">Covered {formatDateOnly(p.coverageStart)} – {formatDateOnly(p.coverageEnd)}</span></span>
                    </label>
                  ))}
                </div>
                {errors.policyId && <p className="field-error" role="alert">{errors.policyId}</p>}
              </fieldset>
            )}
            {!blocked && (
              <div className="max-w-xs">
                <label className="field-label" htmlFor="claim-amt">Claim amount<span className="req">*</span></label>
                <input id="claim-amt" className="input tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!errors.claimAmount} />
                {errors.claimAmount ? <p className="field-error" role="alert">{errors.claimAmount}</p> : <p className="field-hint">Cannot exceed the invoice total less other open claims.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Warn({ children }) {
  return <p role="alert" className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning flex gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden />{children}</p>;
}
