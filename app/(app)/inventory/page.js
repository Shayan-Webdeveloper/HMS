import Link from "next/link";
import { Boxes, TrendingDown, Wallet, FileText, Truck, Plus, Info } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQuery } from "@/lib/validation/common";
import { itemsQuery, poQuery, invLedgerQuery, ITEM_CATEGORIES, INV_MOVEMENT_TYPES, PO_STATUSES, humanize, itemStockLevel } from "@/lib/validation/inventory";
import { inventorySummary, listItems, listPurchaseOrders, listSuppliers, listInventoryLedger, itemOptions, departmentOptions } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";
import { parseLenient } from "@/lib/validation/pharmacy";
import { formatMoney } from "@/lib/utils/money";
import { formatDate } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { LinkTabs } from "@/components/ui/Tabs";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { AddItemButton, EditItemButton } from "@/components/inventory/ItemForm";
import { IssueItemButton } from "@/components/inventory/IssueItem";
import { AddSupplierButton, EditSupplierButton } from "@/components/inventory/SupplierForm";
import { AdjustStockButton, ActiveToggleButton } from "@/components/inventory/common";
import { InventoryLedgerTable, PoStatusBadge } from "@/components/inventory/LedgerTable";

export const metadata = { title: "Inventory & Procurement" };

const parse = parseLenient;

const LEVEL_BADGE = { OUT: <Badge tone="danger">Out of stock</Badge>, LOW: <Badge tone="warning">Low</Badge>, OK: <Badge tone="success">In stock</Badge> };

export default async function InventoryPage({ searchParams }) {
  const session = await requirePageSession("inventory:read");
  const sp = await searchParams;
  const h = await getHospital();
  const canManage = can(session, "inventory:manage");
  const summary = await inventorySummary();
  const tabs = [
    { key: "items", label: "Items" },
    { key: "purchase-orders", label: "Purchase orders", count: summary.openPoCount || undefined },
    { key: "suppliers", label: "Suppliers" },
    { key: "ledger", label: "Ledger" },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab : "items";
  const money = (v) => formatMoney(v, h.currency);
  const action = canManage && {
    items: <AddItemButton variant="primary" />,
    "purchase-orders": <Button variant="primary" icon={Plus} href="/inventory/purchase-orders/new">New purchase order</Button>,
    suppliers: <AddSupplierButton variant="primary" />,
  }[tab];

  return (
    <>
      <PageHeader title="Inventory & Procurement" description="General supplies, purchase orders and suppliers. Medicine stock is managed in Pharmacy." actions={action} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <MetricCard label="Active items" value={summary.active} icon={Boxes} href="/inventory?tab=items&status=ACTIVE" hint={`${summary.out} out of stock`} />
        <MetricCard label="Low stock" value={summary.low} icon={TrendingDown} tone="warning" href="/inventory?tab=items&stock=low&status=ACTIVE" hint="At or below reorder level" />
        <MetricCard label="Stock value" value={money(summary.stockValue)} icon={Wallet} tone="teal" hint="Quantity × unit cost, active items" />
        <MetricCard label="Open purchase orders" value={summary.openPoCount} icon={FileText} tone="info" href="/inventory?tab=purchase-orders&status=ORDERED" hint={`${money(summary.openPoValue)} draft + ordered`} />
      </div>
      <div className="card">
        <LinkTabs tabs={tabs} active={tab} baseHref="/inventory" />
        {tab === "items" && <ItemsTab sp={sp} canManage={canManage} money={money} />}
        {tab === "purchase-orders" && <PurchaseOrdersTab sp={sp} tz={h.timezone} money={money} canManage={canManage} />}
        {tab === "suppliers" && <SuppliersTab sp={sp} money={money} canManage={canManage} />}
        {tab === "ledger" && <LedgerTab sp={sp} tz={h.timezone} />}
      </div>
    </>
  );
}

async function ItemsTab({ sp, canManage, money }) {
  const q = parse(itemsQuery, sp, { sort: "name", dir: "asc" });
  const [{ rows, meta, totals }, departments] = await Promise.all([listItems(q), canManage ? departmentOptions() : []]);
  const params = { tab: "items", q: q.q, status: q.status, stock: q.stock, category: q.category, sort: q.sort, dir: q.dir };
  return (
    <>
      <FilterBar key="items" placeholder="Search code, name or location…" filters={[
        { name: "stock", label: "Stock", options: [{ value: "low", label: "Low (≤ reorder level)" }, { value: "out", label: "Out of stock" }] },
        { name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
        { name: "category", label: "Category", options: ITEM_CATEGORIES.map((c) => ({ value: c, label: humanize(c) })) },
      ]} />
      {totals.items > 0 && (
        <p className="px-4 py-2 text-[12.5px] text-muted bg-surface-2 border-b border-border flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="font-semibold text-ink tabular">{totals.items}</span> item{totals.items === 1 ? "" : "s"}</span>
          <span><span className="font-semibold text-ink tabular">{totals.units.toLocaleString("en")}</span> units on hand</span>
          <span>Stock value <span className="font-semibold text-ink tabular">{money(totals.value)}</span></span>
        </p>
      )}
      <DataTable path="/inventory" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Inventory items"
        empty={<EmptyState icon={Boxes} title={q.q || q.stock || q.status || q.category ? "No items match these filters" : "No inventory items yet"} description={q.stock === "low" ? "Nothing is at or below its reorder level." : "Try a different search or filter."}
          action={canManage && !q.q && !q.stock && <AddItemButton variant="primary" />} />}
        columns={[
          { key: "code", label: "Code", sortable: true, render: (r) => <span className="font-mono text-[12.5px] font-semibold">{r.code}</span> },
          { key: "name", label: "Item", sortable: true, render: (r) => (
            <div className="text-left">
              <Link href={`/inventory/items/${r.id}`} className="font-semibold hover:text-primary">{r.name}</Link>
              {!r.isActive && <Badge tone="neutral" plain className="ml-2">Inactive</Badge>}
              <p className="text-xs text-muted">{[humanize(r.category), r.location].filter(Boolean).join(" · ")}</p>
            </div>
          ) },
          { key: "quantity", label: "On hand", sortable: true, align: "right", render: (r) => <span className="font-semibold tabular">{r.quantity} <span className="text-xs text-subtle font-normal">{r.unit}</span></span> },
          { key: "reorder", label: "Reorder at", align: "right", render: (r) => r.reorderLevel },
          { key: "level", label: "Level", render: (r) => LEVEL_BADGE[itemStockLevel(r.quantity, r.reorderLevel)] },
          { key: "unitCost", label: "Unit cost", sortable: true, align: "right", render: (r) => money(r.unitCost) },
          { key: "value", label: "Value", align: "right", render: (r) => <span className="tabular">{money(r.value)}</span> },
          ...(canManage ? [{ key: "act", label: "", align: "right", render: (r) => {
            const it = serialize({ id: r.id, code: r.code, name: r.name, unit: r.unit, quantity: r.quantity, isActive: r.isActive, category: r.category, reorderLevel: r.reorderLevel, unitCost: r.unitCost, location: r.location });
            return (
              <div className="flex justify-end gap-1">
                <IssueItemButton item={it} departments={departments} />
                <AdjustStockButton endpoint={`/api/inventory/items/${r.id}/adjust`} current={r.quantity} unit={r.unit} subject={r.name} />
                <EditItemButton item={it} size="sm" variant="ghost" />
              </div>
            );
          } }] : []),
        ]} />
      <Pagination path="/inventory" params={params} meta={meta} />
    </>
  );
}

async function PurchaseOrdersTab({ sp, tz, money, canManage }) {
  const q = parse(poQuery, sp, { sort: "createdAt", dir: "desc" });
  const { rows, meta } = await listPurchaseOrders(q, tz);
  const params = { tab: "purchase-orders", q: q.q, status: q.status, supplierId: q.supplierId, from: q.from, to: q.to, sort: q.sort, dir: q.dir };
  return (
    <>
      <FilterBar key="po" placeholder="Search PO number or supplier…" dateRange filters={[{ name: "status", label: "Status", options: PO_STATUSES.map((s) => ({ value: s, label: humanize(s) })) }]} />
      <DataTable path="/inventory" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Purchase orders"
        empty={<EmptyState icon={FileText} title={q.q || q.status ? "No purchase orders match" : "No purchase orders yet"} description="Create a draft, mark it ordered when sent, then receive it into stock."
          action={canManage && !q.q && !q.status && <Button variant="primary" icon={Plus} href="/inventory/purchase-orders/new">New purchase order</Button>} />}
        columns={[
          { key: "poNumber", label: "PO no.", sortable: true, render: (r) => <Link href={`/inventory/purchase-orders/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.poNumber}</Link> },
          { key: "supplier", label: "Supplier", render: (r) => <Link href={`/inventory/suppliers/${r.supplier.id}`} className="hover:text-primary">{r.supplier.name}</Link> },
          { key: "lines", label: "Lines", align: "right", render: (r) => r._count.items },
          { key: "total", label: "Total", sortable: true, align: "right", render: (r) => <span className="font-semibold tabular">{money(r.total)}</span> },
          { key: "status", label: "Status", render: (r) => <PoStatusBadge status={r.status} /> },
          { key: "createdAt", label: "Created", sortable: true, render: (r) => formatDate(r.createdAt, tz) },
          { key: "progress", label: "Ordered / received", render: (r) => <span className="text-[12.5px] text-muted">{r.orderedAt ? formatDate(r.orderedAt, tz) : "—"} / {r.receivedAt ? formatDate(r.receivedAt, tz) : "—"}</span> },
        ]} />
      <Pagination path="/inventory" params={params} meta={meta} />
    </>
  );
}

async function SuppliersTab({ sp, money, canManage }) {
  const q = parse(listQuery, sp, { sort: "name", dir: "asc" });
  const { rows, meta } = await listSuppliers(q);
  const params = { tab: "suppliers", q: q.q, status: q.status, sort: q.sort, dir: q.dir };
  return (
    <>
      <FilterBar key="suppliers" placeholder="Search supplier name, phone or email…" filters={[{ name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] }]} />
      <p className="px-4 py-2 text-[12.5px] text-muted bg-surface-2 border-b border-border flex items-start gap-1.5">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />“Total received value” is the sum of received purchase orders. Supplier payments and outstanding balances are not tracked yet.
      </p>
      <DataTable path="/inventory" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Suppliers"
        empty={<EmptyState icon={Truck} title={q.q ? "No suppliers match your search" : "No suppliers yet"} action={canManage && !q.q && <AddSupplierButton variant="primary" />} />}
        columns={[
          { key: "name", label: "Supplier", sortable: true, render: (r) => <Link href={`/inventory/suppliers/${r.id}`} className="font-semibold hover:text-primary">{r.name}</Link> },
          { key: "contact", label: "Contact", render: (r) => <div className="text-left text-[13px]">{r.phone || "—"}{r.email && <p className="text-xs text-muted">{r.email}</p>}</div> },
          { key: "pos", label: "Purchase orders", align: "right", render: (r) => r._count.purchaseOrders },
          { key: "open", label: "Open orders", align: "right", render: (r) => (r.openCount ? <span className="tabular">{r.openCount} · {money(r.openValue)}</span> : "—") },
          { key: "received", label: "Total received value", align: "right", render: (r) => <span className="font-semibold tabular">{money(r.receivedValue)}</span> },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
          ...(canManage ? [{ key: "act", label: "", align: "right", render: (r) => (
            <div className="flex justify-end gap-1">
              <EditSupplierButton supplier={{ id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address }} size="sm" variant="ghost" />
              <ActiveToggleButton endpoint={`/api/suppliers/${r.id}/active`} isActive={r.isActive} noun="supplier" size="sm"
                deactivateMessage="Inactive suppliers cannot be chosen for new purchase orders or stock receipts. Purchase history is preserved." />
            </div>
          ) }] : []),
        ]} />
      <Pagination path="/inventory" params={params} meta={meta} />
    </>
  );
}

async function LedgerTab({ sp, tz }) {
  const q = parse(invLedgerQuery, sp, { dir: "desc" });
  const [{ rows, meta }, items] = await Promise.all([listInventoryLedger(q, tz), itemOptions({ activeOnly: false })]);
  const params = { tab: "ledger", q: q.q, type: q.type, itemId: q.itemId, from: q.from, to: q.to, dir: q.dir };
  return (
    <>
      <FilterBar key="ledger" placeholder="Search item, department or reason…" dateRange exportHref="/api/inventory/ledger/export" filters={[
        { name: "type", label: "Type", options: INV_MOVEMENT_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
        { name: "itemId", label: "Item", options: items.map((i) => ({ value: i.id, label: `${i.name} (${i.code})` })) },
      ]} />
      <InventoryLedgerTable rows={rows} tz={tz} />
      <Pagination path="/inventory" params={params} meta={meta} />
    </>
  );
}
