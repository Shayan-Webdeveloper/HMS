"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Printer, XCircle, Pill } from "lucide-react";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { PrescriptionDialog } from "./PrescriptionDialog";

export function PrescriptionPanel({ encounterId, patientId, prescriptions, allergies, canPrescribe, canCancel, canPrint }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  return (
    <div>
      {prescriptions.length === 0 ? (
        <EmptyState icon={Pill} title="No prescriptions" description={canPrescribe ? "Add medicines from the pharmacy formulary." : "No medicines were prescribed in this consultation."}
          action={canPrescribe && <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>New prescription</Button>} />
      ) : (
        <div className="space-y-4">
          {prescriptions.map((rx) => {
            const dispensed = rx.items.some((i) => i.dispensedQty > 0);
            const cancellable = canCancel && ["DRAFT", "ACTIVE"].includes(rx.status) && !dispensed;
            return (
              <div key={rx.id} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-surface-2 border-b border-border rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold">{rx.prescriptionNo}</span>
                    <StatusBadge status={rx.status} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {canPrint && <Button size="sm" variant="ghost" icon={Printer} href={`/consultations/prescriptions/${rx.id}/print`}>Print</Button>}
                    {rx.status === "DRAFT" && canPrescribe && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(rx)}>Edit</Button>}
                    {cancellable && <Button size="sm" variant="ghost" icon={XCircle} className="text-danger" onClick={() => setCancelling(rx)}>Cancel</Button>}
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="table table-responsive">
                    <thead><tr><th>Medicine</th><th>Dose</th><th>Route</th><th>Frequency</th><th className="num">Days</th><th className="num">Qty</th><th>Instructions</th></tr></thead>
                    <tbody>
                      {rx.items.map((it) => (
                        <tr key={it.id}>
                          <td data-label="Medicine"><span className="font-medium">{it.medication.genericName} {it.medication.strength}</span>{it.medication.brandName && <span className="block text-xs text-muted">{it.medication.brandName} · {it.medication.dosageForm.toLowerCase()}</span>}</td>
                          <td data-label="Dose">{it.dose}</td>
                          <td data-label="Route">{it.route}</td>
                          <td data-label="Frequency">{it.frequency}</td>
                          <td data-label="Days" className="num">{it.durationDays}</td>
                          <td data-label="Qty" className="num">{it.quantity}{it.dispensedQty > 0 && <span className="block text-xs text-success">{it.dispensedQty} dispensed</span>}</td>
                          <td data-label="Instructions">{it.instructions || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(rx.notes || rx.cancelReason) && (
                  <div className="px-3 py-2 border-t border-border text-[12.5px] text-muted space-y-0.5">
                    {rx.notes && <p><span className="font-semibold text-ink">Notes:</span> {rx.notes}</p>}
                    {rx.cancelReason && <p><span className="font-semibold text-ink">Cancelled:</span> {rx.cancelReason}</p>}
                  </div>
                )}
              </div>
            );
          })}
          {canPrescribe && <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New prescription</Button>}
        </div>
      )}
      {creating && <PrescriptionDialog open onClose={() => setCreating(false)} encounterId={encounterId} patientId={patientId} allergies={allergies} />}
      {editing && <PrescriptionDialog open onClose={() => setEditing(null)} encounterId={encounterId} patientId={patientId} allergies={allergies} initial={editing} />}
      <ConfirmDialog open={!!cancelling} onClose={() => setCancelling(null)} requireReason title={`Cancel ${cancelling?.prescriptionNo ?? "prescription"}?`}
        message="The prescription can no longer be dispensed. This cannot be undone." confirmLabel="Cancel prescription"
        onConfirm={async (reason) => {
          try { await mutate(`/api/prescriptions/${cancelling.id}/cancel`, { reason }, { success: "Prescription cancelled" }); setCancelling(null); router.refresh(); } catch {}
        }} />
    </div>
  );
}
