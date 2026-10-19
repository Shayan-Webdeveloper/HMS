import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { formatDateTime } from "@/lib/utils/time";
import { humanize } from "@/lib/validation/inventory";
import { MovementBadge, SignedQty } from "@/components/pharmacy/LedgerTable";

const PO_TONES = { DRAFT: "neutral", ORDERED: "primary", RECEIVED: "success", CANCELLED: "neutral" };

export function PoStatusBadge({ status }) {
  return <Badge tone={PO_TONES[status] || "neutral"}>{humanize(status)}</Badge>;
}

/** Inventory stock-ledger table (ledger tab and item page). Server component. */
export function InventoryLedgerTable({ rows, tz, showItem = true }) {
  return (
    <DataTable rows={rows} caption="Inventory stock movements"
      empty={<EmptyState title="No stock movements" description="Receipts, issues to departments and adjustments are recorded here." />}
      columns={[
        { key: "at", label: "When", render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt, tz)}</span> },
        ...(showItem ? [{ key: "item", label: "Item", render: (r) => (r.inventoryItem ? <Link href={`/inventory/items/${r.inventoryItem.id}`} className="font-medium hover:text-primary">{r.inventoryItem.name}</Link> : "—") }] : []),
        { key: "type", label: "Type", render: (r) => <MovementBadge type={r.type} /> },
        { key: "qty", label: "Qty", align: "right", render: (r) => <SignedQty value={r.quantity} /> },
        { key: "bal", label: "Balance", align: "right", render: (r) => r.balanceAfter },
        { key: "ref", label: "Reference", render: (r) => (r.purchaseOrder ? <Link href={`/inventory/purchase-orders/${r.purchaseOrder.id}`} className="font-mono text-[12.5px] text-primary hover:underline">{r.purchaseOrder.poNumber}</Link> : "—") },
        { key: "reason", label: "Reason", render: (r) => <span className="text-[13px] text-muted">{r.reason || "—"}</span> },
        { key: "by", label: "By", render: (r) => r.performedByName },
      ]} />
  );
}
