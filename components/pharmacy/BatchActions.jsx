"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mutate } from "@/components/ui/api-client";
import { AdjustStockButton } from "@/components/inventory/common";

/** Row actions for one medication batch: +/- adjustment and (for expired stock) write-off. */
export function BatchActions({ batch, unit, expired }) {
  const router = useRouter();
  const [writeOff, setWriteOff] = useState(false);
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <AdjustStockButton endpoint={`/api/pharmacy/batches/${batch.id}/adjust`} current={batch.quantity} unit={unit} subject={`Batch ${batch.batchNo}`} />
      {expired && batch.quantity > 0 && (
        <Button size="sm" variant="ghost" icon={Trash2} className="text-danger" onClick={() => setWriteOff(true)} aria-label={`Write off expired batch ${batch.batchNo}`}>Write off</Button>
      )}
      <ConfirmDialog open={writeOff} onClose={() => setWriteOff(false)} requireReason tone="danger"
        title={`Write off batch ${batch.batchNo}?`}
        message={`All ${batch.quantity} ${unit} in this expired batch will be removed from stock and recorded as EXPIRED in the ledger. This cannot be undone.`}
        confirmLabel="Write off" reasonLabel="Reason / disposal reference"
        onConfirm={async (reason) => {
          try {
            await mutate(`/api/pharmacy/batches/${batch.id}/write-off`, { quantity: batch.quantity, reason }, { success: `Batch ${batch.batchNo} written off` });
            setWriteOff(false); router.refresh();
          } catch {}
        }} />
    </div>
  );
}
