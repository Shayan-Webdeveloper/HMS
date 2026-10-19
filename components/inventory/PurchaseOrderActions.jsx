"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, PackageCheck, Pencil, Printer, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mutate } from "@/components/ui/api-client";
import { PO_TRANSITIONS } from "@/lib/validation/inventory";

/** Status actions for a purchase order; only transitions allowed by PO_TRANSITIONS are offered. */
export function PurchaseOrderActions({ po, canManage, units }) {
  const router = useRouter();
  const [dialog, setDialog] = useState(null);
  const next = PO_TRANSITIONS[po.status] || [];
  async function go(status, reason) {
    const labels = { ORDERED: "Marked as ordered", RECEIVED: "Stock received", CANCELLED: "Purchase order cancelled" };
    try {
      await mutate(`/api/purchase-orders/${po.id}/status`, { status, ...(reason ? { reason } : {}) }, { success: labels[status] });
      setDialog(null);
      router.refresh();
    } catch {}
  }
  return (
    <div className="flex flex-wrap gap-2 no-print">
      {canManage && po.status === "DRAFT" && <Button icon={Pencil} href={`/inventory/purchase-orders/${po.id}/edit`}>Edit</Button>}
      {canManage && next.includes("ORDERED") && <Button variant="primary" icon={Send} onClick={() => setDialog("ORDERED")}>Mark as ordered</Button>}
      {canManage && next.includes("RECEIVED") && <Button variant="success" icon={PackageCheck} onClick={() => setDialog("RECEIVED")}>Receive stock</Button>}
      <Button icon={Printer} href={`/inventory/purchase-orders/${po.id}/print`}>Print</Button>
      {canManage && next.includes("CANCELLED") && <Button variant="ghost" icon={Ban} className="text-danger" onClick={() => setDialog("CANCELLED")}>Cancel order</Button>}

      <ConfirmDialog open={dialog === "ORDERED"} onClose={() => setDialog(null)} tone="primary" title={`Mark ${po.poNumber} as ordered?`}
        message="Confirms the order has been sent to the supplier. Lines can no longer be edited after this." confirmLabel="Mark as ordered" onConfirm={() => go("ORDERED")} />
      <ConfirmDialog open={dialog === "RECEIVED"} onClose={() => setDialog(null)} tone="primary" title={`Receive ${po.poNumber}?`}
        message={`${units} unit${units === 1 ? "" : "s"} will be added to stock, each line is recorded in the ledger and item unit costs are updated to this order's prices. This cannot be undone.`}
        confirmLabel="Receive into stock" onConfirm={() => go("RECEIVED")} />
      <ConfirmDialog open={dialog === "CANCELLED"} onClose={() => setDialog(null)} tone="danger" requireReason title={`Cancel ${po.poNumber}?`}
        message="The purchase order will be closed without receiving stock. It stays on record for audit." confirmLabel="Cancel order" onConfirm={(reason) => go("CANCELLED", reason)} />
    </div>
  );
}
