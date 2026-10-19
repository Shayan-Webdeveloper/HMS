"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDollarSign, XCircle, Percent } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { api } from "@/components/ui/api-client";
import { resolveClaimDecision, insuranceSettlementAmount, canTransitionClaim } from "@/lib/validation/insurance";
import { formatMoney, D } from "@/lib/utils/money";

const TITLES = { APPROVED: "Approve claim", PARTIALLY_APPROVED: "Partially approve claim", REJECTED: "Reject claim", PAID: "Mark claim paid" };

export function ClaimActions({ claim, invoiceBalance, invoiceStatus, currency, locale }) {
  const [mode, setMode] = useState(null);
  const can = (to) => canTransitionClaim(claim.status, to);
  if (!["APPROVED", "PARTIALLY_APPROVED", "REJECTED", "PAID"].some(can)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {can("APPROVED") && <Button variant="success" icon={CheckCircle2} onClick={() => setMode("APPROVED")}>Approve</Button>}
      {can("PARTIALLY_APPROVED") && <Button icon={Percent} onClick={() => setMode("PARTIALLY_APPROVED")}>Partially approve</Button>}
      {can("REJECTED") && <Button variant="ghost" className="text-danger" icon={XCircle} onClick={() => setMode("REJECTED")}>Reject</Button>}
      {can("PAID") && <Button variant="primary" icon={CircleDollarSign} onClick={() => setMode("PAID")}>Mark paid</Button>}
      {mode && <DecisionDialog mode={mode} claim={claim} invoiceBalance={invoiceBalance} invoiceStatus={invoiceStatus} currency={currency} locale={locale} onClose={() => setMode(null)} />}
    </div>
  );
}

function DecisionDialog({ mode, claim, invoiceBalance, invoiceStatus, currency, locale, onClose }) {
  const router = useRouter();
  const money = (v) => formatMoney(v, currency, locale);
  const [amount, setAmount] = useState(mode === "APPROVED" ? D(claim.claimAmount).toFixed(2) : "");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const settlement = mode === "PAID" ? insuranceSettlementAmount(claim.approvedAmount, invoiceStatus === "VOID" ? 0 : invoiceBalance) : null;

  async function go() {
    const body = { status: mode };
    if (mode === "PARTIALLY_APPROVED" || mode === "APPROVED") body.approvedAmount = amount;
    if (mode === "REJECTED") body.rejectionReason = reason;
    if (mode === "PAID" && reference.trim()) body.reference = reference.trim();
    const check = resolveClaimDecision(claim, body);
    if (check.error) { setError(check.error); return; }
    setBusy(true);
    try {
      const r = await api(`/api/insurance/claims/${claim.id}/status`, { method: "POST", body });
      toast.success(mode === "PAID" ? `Claim settled — receipt ${r.data.payment?.receiptNo ?? ""}` : "Claim updated");
      onClose(); router.refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={TITLES[mode]} description={`${claim.claimNo} · claimed ${money(claim.claimAmount)}`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant={mode === "REJECTED" ? "danger" : "primary"} loading={busy} onClick={go} disabled={mode === "PAID" && D(settlement).lte(0)}>{TITLES[mode]}</Button></>}>
      <div className="space-y-4 text-[13.5px]">
        {mode === "APPROVED" && <p className="text-muted">Record that the insurer approved the full claimed amount of <span className="font-semibold text-ink">{money(claim.claimAmount)}</span>.</p>}
        {mode === "PARTIALLY_APPROVED" && (
          <div className="max-w-xs">
            <label className="field-label" htmlFor="cl-amt">Approved amount<span className="req">*</span></label>
            <input id="cl-amt" className="input tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!error} />
            <p className="field-hint">More than zero and less than {money(claim.claimAmount)}.</p>
          </div>
        )}
        {mode === "REJECTED" && (
          <div>
            <label className="field-label" htmlFor="cl-reason">Rejection reason<span className="req">*</span></label>
            <textarea id="cl-reason" className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="As stated by the insurer, e.g. Policy excludes pre-existing condition" aria-invalid={!!error} />
          </div>
        )}
        {mode === "PAID" && (
          <>
            <dl className="grid grid-cols-3 gap-3 rounded-lg bg-surface-2 border border-border p-3">
              <div><dt className="text-xs text-muted">Approved</dt><dd className="tabular font-medium">{money(claim.approvedAmount)}</dd></div>
              <div><dt className="text-xs text-muted">Invoice balance</dt><dd className="tabular font-medium">{money(invoiceBalance)}</dd></div>
              <div><dt className="text-xs text-muted">Will be posted</dt><dd className="tabular font-semibold">{money(settlement)}</dd></div>
            </dl>
            <p className="text-muted">An <span className="font-semibold text-ink">Insurance</span> payment for the posted amount is recorded on the invoice (capped at its balance) in the same transaction.</p>
            {D(settlement).lte(0) && <p role="alert" className="text-warning">The invoice has no outstanding balance. If the patient already paid, refund the patient first, then mark the claim paid.</p>}
            <div>
              <label className="field-label" htmlFor="cl-ref">Insurer remittance reference</label>
              <input id="cl-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
            </div>
          </>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
