import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { getPurchaseOrder } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";
import { humanize } from "@/lib/validation/inventory";
import { formatMoney } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/time";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { PurchaseOrderActions } from "@/components/inventory/PurchaseOrderActions";
import { PoStatusBadge } from "@/components/inventory/LedgerTable";

export const metadata = { title: "Purchase order" };

const ACTION_LABEL = { "purchaseOrder.create": "Draft created", "purchaseOrder.update": "Draft edited", "purchaseOrder.ordered": "Marked as ordered", "purchaseOrder.received": "Received into stock", "purchaseOrder.cancelled": "Cancelled" };

export default async function PurchaseOrderPage({ params }) {
  const session = await requirePageSession("inventory:read");
  const { id } = await params;
  const [po, h] = await Promise.all([getPurchaseOrder(id), getHospital()]);
  if (!po) notFound();
  const money = (v) => formatMoney(v, h.currency);
  const tz = h.timezone;
  const units = po.items.reduce((s, l) => s + l.quantity, 0);

  return (
    <>
      <Link href="/inventory?tab=purchase-orders" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft size={14} aria-hidden /> Purchase orders</Link>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-[21px] font-bold tracking-tight">{po.poNumber}</h1>
              <PoStatusBadge status={po.status} />
            </div>
            <p className="text-[13px] text-muted mt-1">
              Supplier <Link href={`/inventory/suppliers/${po.supplier.id}`} className="font-semibold text-ink hover:text-primary">{po.supplier.name}</Link>
              {!po.supplier.isActive && <Badge tone="neutral" plain className="ml-2">Inactive supplier</Badge>}
            </p>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-[12.5px]">
              <div><dt className="inline text-muted">Created </dt><dd className="inline">{formatDateTime(po.createdAt, tz)}{po.createdByName ? ` by ${po.createdByName}` : ""}</dd></div>
              <div><dt className="inline text-muted">Ordered </dt><dd className="inline">{formatDateTime(po.orderedAt, tz)}</dd></div>
              <div><dt className="inline text-muted">Received </dt><dd className="inline">{formatDateTime(po.receivedAt, tz)}</dd></div>
            </dl>
          </div>
          <PurchaseOrderActions po={{ id: po.id, poNumber: po.poNumber, status: po.status }} canManage={can(session, "inventory:manage")} units={units} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5">
        <Card title="Order lines" noPadding>
          <DataTable rows={po.items} caption="Order lines"
            columns={[
              { key: "item", label: "Item", render: (l) => <div className="text-left"><Link href={`/inventory/items/${l.inventoryItem.id}`} className="font-medium hover:text-primary">{l.inventoryItem.name}</Link><p className="text-xs text-muted font-mono">{l.inventoryItem.code}</p></div> },
              { key: "qty", label: "Quantity", align: "right", render: (l) => <span className="tabular">{l.quantity} <span className="text-xs text-subtle">{l.inventoryItem.unit}</span></span> },
              { key: "cost", label: "Unit cost", align: "right", render: (l) => money(l.unitCost) },
              { key: "total", label: "Line total", align: "right", render: (l) => <span className="font-semibold tabular">{money(l.lineTotal)}</span> },
            ]} />
          <div className="flex justify-end gap-6 px-4 py-3 border-t border-border bg-surface-2 rounded-b-xl text-[14px]">
            <span className="text-muted">{po.items.length} line{po.items.length === 1 ? "" : "s"} · {units} units</span>
            <span>Total <span className="font-bold tabular ml-2">{money(po.total)}</span></span>
          </div>
        </Card>
        <Card title="History">
          {po.history.length === 0 ? <p className="text-[13px] text-muted">No recorded activity.</p> : (
            <ol className="timeline">
              {po.history.map((a) => (
                <li key={a.id} className="timeline-item">
                  <p className="text-[13px] font-medium">{ACTION_LABEL[a.action] || humanize(a.action.split(".").pop())}</p>
                  <p className="text-xs text-subtle">{formatDateTime(a.createdAt, tz)} · {a.user?.name || "System"}</p>
                  {a.metadata?.reason && <p className="text-xs text-muted mt-0.5">Reason: {a.metadata.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
