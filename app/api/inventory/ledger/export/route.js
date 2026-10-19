import { route } from "@/lib/api/handler";
import { invLedgerQuery } from "@/lib/validation/inventory";
import { listInventoryLedger } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";
import { toCsv, MAX_EXPORT_ROWS } from "@/lib/utils/csv";
import { audit } from "@/lib/audit";

export const GET = route({ permission: "inventory:read" }, async ({ query, session, ip }) => {
  const q = query(invLedgerQuery.omit({ page: true, pageSize: true }));
  const h = await getHospital();
  const { rows, meta } = await listInventoryLedger({ ...q, page: 1, pageSize: MAX_EXPORT_ROWS }, h.timezone);
  await audit({ userId: session.user.id, action: "inventory.ledger.export", entityType: "StockMovement", metadata: { rows: rows.length, filters: { q: q.q, type: q.type, itemId: q.itemId, from: q.from, to: q.to } }, ipAddress: ip });
  const csv = toCsv([
    { label: "Date (UTC)", value: (r) => r.createdAt.toISOString() },
    { label: "Type", key: "type" },
    { label: "Item code", value: (r) => r.inventoryItem?.code },
    { label: "Item", value: (r) => r.inventoryItem?.name },
    // Signed numbers would be quote-prefixed by the CSV formula-injection guard, so split into in/out columns.
    { label: "Quantity in", value: (r) => (r.quantity > 0 ? r.quantity : "") },
    { label: "Quantity out", value: (r) => (r.quantity < 0 ? Math.abs(r.quantity) : "") },
    { label: "Balance after", key: "balanceAfter" },
    { label: "Unit", value: (r) => r.inventoryItem?.unit },
    { label: "Reason", key: "reason" },
    { label: "Reference type", key: "referenceType" },
    { label: "Reference", value: (r) => r.purchaseOrder?.poNumber || r.referenceId },
    { label: "Performed by", key: "performedByName" },
  ], rows);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="inventory-ledger-${new Date().toISOString().slice(0, 10)}.csv"`, "X-Total-Rows": String(meta.total), "Cache-Control": "no-store" } });
});
