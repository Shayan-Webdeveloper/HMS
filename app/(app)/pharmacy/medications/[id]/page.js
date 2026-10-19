import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes, CalendarClock, PackageX, Tag } from "lucide-react";
import { z } from "zod";
import { requirePageSession, can } from "@/lib/auth/session";
import { getMedication, listMedicationLedger, pharmacyContext, activeSupplierOptions, medicationCategories } from "@/lib/services/pharmacy";
import { humanize, stockLevel, daysUntil } from "@/lib/validation/pharmacy";
import { formatMoney } from "@/lib/utils/money";
import { formatDateOnly, formatDateTime } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { Card } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { ReceiveStockButton } from "@/components/pharmacy/ReceiveStock";
import { EditMedicationButton } from "@/components/pharmacy/MedicationForm";
import { BatchActions } from "@/components/pharmacy/BatchActions";
import { MedicationLedgerTable } from "@/components/pharmacy/LedgerTable";
import { ActiveToggleButton } from "@/components/inventory/common";

export const metadata = { title: "Medication" };

const pageParam = z.coerce.number().int().min(1).max(10000).catch(1);
const LEVEL = { OUT: ["danger", "Out of stock"], LOW: ["warning", "Low stock"], OK: ["success", "In stock"] };

export default async function MedicationPage({ params, searchParams }) {
  const session = await requirePageSession("pharmacy:read");
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await pharmacyContext();
  const m = await getMedication(id, ctx);
  if (!m) notFound();
  const canManage = can(session, "pharmacy:manage");
  const page = pageParam.parse(sp.page ?? 1);
  const showAll = sp.batches === "all";
  const [ledger, suppliers, categories] = await Promise.all([
    listMedicationLedger({ q: "", medicationId: id, page, pageSize: 20, dir: "desc" }, ctx.tz),
    canManage ? activeSupplierOptions() : [],
    canManage ? medicationCategories() : [],
  ]);
  const level = stockLevel(m.onHand, m.reorderLevel);
  const depleted = m.batches.filter((b) => b.quantity === 0).length;
  const batches = showAll ? m.batches : m.batches.filter((b) => b.quantity > 0);
  const med = serialize({ id: m.id, code: m.code, genericName: m.genericName, brandName: m.brandName, strength: m.strength, dosageForm: m.dosageForm, category: m.category, manufacturer: m.manufacturer, unit: m.unit, sellingPrice: m.sellingPrice, reorderLevel: m.reorderLevel, isActive: m.isActive });

  return (
    <>
      <Link href="/pharmacy?tab=stock" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft size={14} aria-hidden /> Pharmacy stock</Link>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[21px] font-bold tracking-tight">{m.genericName} {m.strength}</h1>
              <Badge tone={LEVEL[level][0]}>{LEVEL[level][1]}</Badge>
              {!m.isActive && <StatusBadge status="INACTIVE" />}
            </div>
            <p className="text-[13px] text-muted mt-0.5">
              <span className="font-mono font-semibold text-ink">{m.code}</span>
              {[m.brandName, humanize(m.dosageForm), m.category, m.manufacturer].filter(Boolean).map((x) => <span key={x}> · {x}</span>)}
            </p>
            <p className="text-[13px] text-muted mt-1">Selling price <span className="font-semibold text-ink tabular">{formatMoney(m.sellingPrice, ctx.currency)}</span> per {m.unit} · Reorder at <span className="font-semibold text-ink tabular">{m.reorderLevel}</span></p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {m.isActive && <ReceiveStockButton medication={med} suppliers={suppliers} />}
              <EditMedicationButton medication={med} categories={categories} />
              <ActiveToggleButton endpoint={`/api/pharmacy/medications/${m.id}/active`} isActive={m.isActive} noun="medication"
                deactivateMessage="Inactive medicines cannot be prescribed or receive new stock. Existing stock can still be dispensed and history is preserved." />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <MetricCard label="Usable on hand" value={m.onHand} icon={Boxes} tone={level === "OK" ? "success" : level === "LOW" ? "warning" : "danger"} hint={`${m.unit} in non-expired batches`} />
        <MetricCard label={`Expiring ≤ ${ctx.alertDays} days`} value={m.expiringQty} icon={CalendarClock} tone="info" hint={m.nextExpiry ? `Next expiry ${formatDateOnly(m.nextExpiry)}` : "No usable batches"} />
        <MetricCard label="Expired on shelf" value={m.expiredQty} icon={PackageX} tone="danger" hint={m.expiredQty ? "Write off below" : "Nothing to write off"} />
        <MetricCard label="Batches with stock" value={m.batches.filter((b) => b.quantity > 0).length} icon={Tag} tone="primary" hint={`${m.batches.length} received in total`} />
      </div>

      <Card title="Batches" description="First-expiry-first-out order. Expired batches are never dispensed." noPadding className="mb-5"
        actions={depleted > 0 && <Link className="text-[12.5px] font-semibold text-primary hover:underline" href={showAll ? `/pharmacy/medications/${m.id}` : `/pharmacy/medications/${m.id}?batches=all`} scroll={false}>{showAll ? "Hide depleted" : `Show depleted (${depleted})`}</Link>}>
        <DataTable rows={batches} caption="Batches"
          empty={<EmptyState icon={Boxes} title="No stock on hand" description={canManage ? "Use “Receive stock” to add a batch." : "Stock received by the pharmacy appears here."} />}
          columns={[
            { key: "batchNo", label: "Batch", render: (b) => <span className={`font-mono text-[12.5px] font-semibold ${b.quantity === 0 ? "text-subtle" : ""}`}>{b.batchNo}</span> },
            { key: "expiry", label: "Expiry", render: (b) => (
              <span className="inline-flex flex-wrap items-center gap-2">
                {formatDateOnly(b.expiryDate)}
                {b.expiry === "EXPIRED" && <Badge tone="danger">Expired</Badge>}
                {b.expiry === "EXPIRING" && <Badge tone="warning">{daysUntil(b.expiryDate, ctx.today)} days</Badge>}
              </span>
            ) },
            { key: "qty", label: "Quantity", align: "right", render: (b) => <span className={`font-semibold tabular ${b.expiry === "EXPIRED" && b.quantity > 0 ? "text-danger" : ""}`}>{b.quantity}</span> },
            { key: "cost", label: "Purchase cost", align: "right", render: (b) => formatMoney(b.purchaseCost, ctx.currency) },
            { key: "supplier", label: "Supplier", render: (b) => b.supplier?.name || "—" },
            { key: "received", label: "Received", render: (b) => formatDateTime(b.receivedAt, ctx.tz) },
            ...(canManage ? [{ key: "act", label: "", align: "right", render: (b) => <BatchActions batch={{ id: b.id, batchNo: b.batchNo, quantity: b.quantity }} unit={m.unit} expired={b.expiry === "EXPIRED"} /> }] : []),
          ]} />
      </Card>

      <Card title="Stock movements" description="Every quantity change for this medicine." noPadding
        actions={<Link className="text-[12.5px] font-semibold text-primary hover:underline" href={`/pharmacy?tab=ledger&medicationId=${m.id}`}>Open in ledger</Link>}>
        <MedicationLedgerTable rows={ledger.rows} tz={ctx.tz} showMedication={false} />
        <Pagination path={`/pharmacy/medications/${m.id}`} params={{ batches: showAll ? "all" : undefined }} meta={ledger.meta} />
      </Card>
    </>
  );
}
