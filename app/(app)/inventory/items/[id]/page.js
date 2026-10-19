import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes, Wallet, TrendingDown, FileText } from "lucide-react";
import { z } from "zod";
import { requirePageSession, can } from "@/lib/auth/session";
import { getItem, listInventoryLedger, departmentOptions } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";
import { humanize, itemStockLevel } from "@/lib/validation/inventory";
import { formatMoney } from "@/lib/utils/money";
import { formatDate } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { Card } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { EditItemButton } from "@/components/inventory/ItemForm";
import { IssueItemButton } from "@/components/inventory/IssueItem";
import { AdjustStockButton, ActiveToggleButton } from "@/components/inventory/common";
import { InventoryLedgerTable, PoStatusBadge } from "@/components/inventory/LedgerTable";

export const metadata = { title: "Inventory item" };

const pageParam = z.coerce.number().int().min(1).max(10000).catch(1);
const LEVEL = { OUT: ["danger", "Out of stock"], LOW: ["warning", "Low stock"], OK: ["success", "In stock"] };

export default async function InventoryItemPage({ params, searchParams }) {
  const session = await requirePageSession("inventory:read");
  const { id } = await params;
  const sp = await searchParams;
  const [it, h] = await Promise.all([getItem(id), getHospital()]);
  if (!it) notFound();
  const canManage = can(session, "inventory:manage");
  const page = pageParam.parse(sp.page ?? 1);
  const [ledger, departments] = await Promise.all([
    listInventoryLedger({ q: "", itemId: id, page, pageSize: 20, dir: "desc" }, h.timezone),
    canManage ? departmentOptions() : [],
  ]);
  const money = (v) => formatMoney(v, h.currency);
  const level = itemStockLevel(it.quantity, it.reorderLevel);
  const item = serialize({ id: it.id, code: it.code, name: it.name, category: it.category, unit: it.unit, quantity: it.quantity, reorderLevel: it.reorderLevel, unitCost: it.unitCost, location: it.location, isActive: it.isActive });

  return (
    <>
      <Link href="/inventory?tab=items" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft size={14} aria-hidden /> Inventory items</Link>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[21px] font-bold tracking-tight">{it.name}</h1>
              <Badge tone={LEVEL[level][0]}>{LEVEL[level][1]}</Badge>
              {!it.isActive && <StatusBadge status="INACTIVE" />}
            </div>
            <p className="text-[13px] text-muted mt-0.5"><span className="font-mono font-semibold text-ink">{it.code}</span> · {humanize(it.category)} · counted in {it.unit}{it.location ? ` · ${it.location}` : ""}</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <IssueItemButton item={item} departments={departments} size="md" variant="primary" />
              <AdjustStockButton endpoint={`/api/inventory/items/${it.id}/adjust`} current={it.quantity} unit={it.unit} subject={it.name} size="md" variant="secondary" label="Adjust stock" />
              <EditItemButton item={item} />
              <ActiveToggleButton endpoint={`/api/inventory/items/${it.id}/active`} isActive={it.isActive} noun="item"
                deactivateMessage="Inactive items cannot be issued or added to new purchase orders. Stock history is preserved." />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <MetricCard label="On hand" value={it.quantity} icon={Boxes} tone={level === "OK" ? "success" : level === "LOW" ? "warning" : "danger"} hint={it.unit} />
        <MetricCard label="Reorder level" value={it.reorderLevel} icon={TrendingDown} tone="warning" hint={level === "OK" ? "Above reorder level" : "Reorder now"} />
        <MetricCard label="Unit cost" value={money(it.unitCost)} icon={FileText} tone="info" hint="Latest received price" />
        <MetricCard label="Stock value" value={money(it.value)} icon={Wallet} tone="teal" hint="Quantity × unit cost" />
      </div>

      <Card title="Stock movements" noPadding className="mb-5"
        actions={<Link className="text-[12.5px] font-semibold text-primary hover:underline" href={`/inventory?tab=ledger&itemId=${it.id}`}>Open in ledger</Link>}>
        <InventoryLedgerTable rows={ledger.rows} tz={h.timezone} showItem={false} />
        <Pagination path={`/inventory/items/${it.id}`} meta={ledger.meta} />
      </Card>

      <Card title="Purchase history" description="Most recent purchase-order lines for this item." noPadding>
        <DataTable rows={it.poLines} caption="Purchase history" empty={<EmptyState icon={FileText} title="Not ordered yet" />}
          columns={[
            { key: "po", label: "PO no.", render: (l) => <Link href={`/inventory/purchase-orders/${l.purchaseOrder.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{l.purchaseOrder.poNumber}</Link> },
            { key: "supplier", label: "Supplier", render: (l) => <Link href={`/inventory/suppliers/${l.purchaseOrder.supplier.id}`} className="hover:text-primary">{l.purchaseOrder.supplier.name}</Link> },
            { key: "qty", label: "Quantity", align: "right", render: (l) => l.quantity },
            { key: "cost", label: "Unit cost", align: "right", render: (l) => money(l.unitCost) },
            { key: "status", label: "Status", render: (l) => <PoStatusBadge status={l.purchaseOrder.status} /> },
            { key: "date", label: "Created / received", render: (l) => <span className="text-[12.5px] text-muted">{formatDate(l.purchaseOrder.createdAt, h.timezone)} / {l.purchaseOrder.receivedAt ? formatDate(l.purchaseOrder.receivedAt, h.timezone) : "—"}</span> },
          ]} />
      </Card>
    </>
  );
}
