import Link from "next/link";
import { ClipboardList, TrendingDown, CalendarClock, PackageX, Pill, Search } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listQuery } from "@/lib/validation/common";
import {
  stockQuery, catalogueQuery, medLedgerQuery, DOSAGE_FORMS, STOCK_FILTERS, MED_MOVEMENT_TYPES, DISPENSABLE_STATUSES,
  humanize, classifyExpiry, stockLevel, daysUntil, parseLenient,
} from "@/lib/validation/pharmacy";
import {
  pharmacyContext, pharmacySummary, listPrescriptionQueue, listStock, listCatalogue, listMedicationLedger,
  medicationCategories, medicationOptions, activeSupplierOptions,
} from "@/lib/services/pharmacy";
import { formatMoney } from "@/lib/utils/money";
import { formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { LinkTabs } from "@/components/ui/Tabs";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { StatusPills } from "@/components/pharmacy/StatusPills";
import { AddMedicationButton, EditMedicationButton } from "@/components/pharmacy/MedicationForm";
import { ReceiveStockButton } from "@/components/pharmacy/ReceiveStock";
import { ActiveToggleButton } from "@/components/inventory/common";
import { MedicationLedgerTable } from "@/components/pharmacy/LedgerTable";

export const metadata = { title: "Pharmacy" };

const parse = parseLenient;

const LEVEL_BADGE = { OUT: <Badge tone="danger">Out of stock</Badge>, LOW: <Badge tone="warning">Low</Badge>, OK: <Badge tone="success">In stock</Badge> };

export default async function PharmacyPage({ searchParams }) {
  const session = await requirePageSession("pharmacy:read");
  const sp = await searchParams;
  const ctx = await pharmacyContext();
  const canRx = can(session, "prescriptions:read");
  const canManage = can(session, "pharmacy:manage");
  const [summary, categories, suppliers] = await Promise.all([pharmacySummary(ctx), medicationCategories(), canManage ? activeSupplierOptions() : []]);

  const tabs = [
    canRx && { key: "prescriptions", label: "Prescriptions", count: summary.queue },
    { key: "stock", label: "Stock" },
    { key: "catalogue", label: "Catalogue" },
    { key: "ledger", label: "Ledger" },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab : tabs[0].key;

  return (
    <>
      <PageHeader title="Pharmacy" description="Dispensing queue, medicine stock by batch, catalogue and the stock ledger."
        actions={canManage && <><AddMedicationButton categories={categories} /><ReceiveStockButton suppliers={suppliers} /></>} />
      <div className={`grid grid-cols-2 ${canRx ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-3 sm:gap-4 mb-5`}>
        {canRx && <MetricCard label="Awaiting dispensing" value={summary.queue} icon={ClipboardList} href="/pharmacy?tab=prescriptions" hint="Active & partially dispensed" />}
        <MetricCard label="Low stock medicines" value={summary.low} icon={TrendingDown} tone="warning" href="/pharmacy?tab=stock&status=low" hint={`${summary.out} out of stock`} />
        <MetricCard label="Batches expiring soon" value={summary.expiringBatches} icon={CalendarClock} tone="info" href="/pharmacy?tab=stock&status=expiring" hint={`Within ${ctx.alertDays} days`} />
        <MetricCard label="Expired on shelf" value={summary.expiredBatches} icon={PackageX} tone="danger" href="/pharmacy?tab=stock&status=expired" hint="Batches awaiting write-off" />
      </div>
      <div className="card">
        <LinkTabs tabs={tabs} active={tab} baseHref="/pharmacy" />
        {tab === "prescriptions" && <PrescriptionsTab sp={sp} ctx={ctx} session={session} />}
        {tab === "stock" && <StockTab sp={sp} ctx={ctx} categories={categories} />}
        {tab === "catalogue" && <CatalogueTab sp={sp} ctx={ctx} canManage={canManage} categories={categories} />}
        {tab === "ledger" && <LedgerTab sp={sp} ctx={ctx} />}
      </div>
    </>
  );
}

async function PrescriptionsTab({ sp, ctx, session }) {
  const queueView = !sp.status || DISPENSABLE_STATUSES.includes(sp.status);
  const q = parse(listQuery, sp, { sort: "createdAt", dir: queueView ? "asc" : "desc" });
  const [{ rows, meta }, counts] = await Promise.all([
    listPrescriptionQueue(q, ctx.tz),
    prisma.prescription.groupBy({ by: ["status"], where: { status: { in: DISPENSABLE_STATUSES } }, _count: { _all: true } }),
  ]);
  const c = Object.fromEntries(counts.map((r) => [r.status, r._count._all]));
  const params = { tab: "prescriptions", q: q.q, status: sp.status, from: sp.from, to: sp.to, sort: q.sort, dir: q.dir };
  const canDispense = can(session, "pharmacy:dispense");
  return (
    <>
      <StatusPills path="/pharmacy" params={params} active={sp.status} label="Prescription status" options={[
        { value: "", label: "Awaiting dispensing", count: (c.ACTIVE ?? 0) + (c.PARTIALLY_DISPENSED ?? 0) },
        { value: "ACTIVE", label: "New", count: c.ACTIVE ?? 0 },
        { value: "PARTIALLY_DISPENSED", label: "Partially dispensed", count: c.PARTIALLY_DISPENSED ?? 0 },
        { value: "DISPENSED", label: "Dispensed" },
        { value: "CANCELLED", label: "Cancelled" },
        { value: "ALL", label: "All" },
      ]} />
      <FilterBar key="rx" placeholder="Search Rx no., patient name, MRN or phone…" dateRange />
      <DataTable path="/pharmacy" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Prescriptions"
        empty={<EmptyState icon={q.q ? Search : ClipboardList} title={q.q ? "No prescriptions match your search" : queueView ? "The dispensing queue is clear" : "No prescriptions in this view"}
          description={q.q ? "Check the prescription number, or search by patient name or MRN." : queueView ? "New prescriptions issued by doctors appear here." : "Try another status or date range."} />}
        columns={[
          { key: "prescriptionNo", label: "Rx no.", sortable: true, render: (r) => <Link href={`/pharmacy/prescriptions/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.prescriptionNo}</Link> },
          { key: "patient", label: "Patient", render: (r) => <div className="text-left"><p className="font-medium">{r.patient.firstName} {r.patient.lastName}</p><p className="text-xs text-muted font-mono">{r.patient.mrn}</p></div> },
          { key: "doctor", label: "Prescriber", render: (r) => `Dr. ${r.doctor.staff.firstName} ${r.doctor.staff.lastName}` },
          { key: "items", label: "Items", render: (r) => {
            const done = r.items.filter((i) => i.dispensedQty >= i.quantity).length;
            const left = r.items.reduce((s, i) => s + Math.max(0, i.quantity - i.dispensedQty), 0);
            return <span className="tabular">{done}/{r.items.length} complete{left > 0 && <span className="text-xs text-muted"> · {left} units left</span>}</span>;
          } },
          { key: "createdAt", label: "Issued", sortable: true, render: (r) => formatDateTime(r.issuedAt ?? r.createdAt, ctx.tz) },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "act", label: "", align: "right", render: (r) => (
            <Button size="sm" variant={canDispense && DISPENSABLE_STATUSES.includes(r.status) ? "primary" : "secondary"} href={`/pharmacy/prescriptions/${r.id}`}>
              {canDispense && DISPENSABLE_STATUSES.includes(r.status) ? "Dispense" : "View"}
            </Button>
          ) },
        ]} />
      <Pagination path="/pharmacy" params={params} meta={meta} />
    </>
  );
}

async function StockTab({ sp, ctx, categories }) {
  const q = parse(stockQuery, sp, { sort: "name", dir: "asc" });
  const { rows, meta } = await listStock(q, ctx);
  const params = { tab: "stock", q: q.q, status: q.status, category: q.category, sort: q.sort, dir: q.dir };
  const note = {
    low: "Active medicines whose usable stock (non-expired batches) is at or below the reorder level.",
    out: "Active medicines with no usable stock.",
    expiring: `Medicines with stock in batches expiring within ${ctx.alertDays} days (pharmacy setting “expiry alert days”).`,
    expired: "Medicines with expired batches still holding stock. Open the medicine to write them off.",
  }[q.status];
  return (
    <>
      <FilterBar key="stock" placeholder="Search medicine name, brand or code…" filters={[
        { name: "status", label: "Stock status", options: STOCK_FILTERS },
        { name: "category", label: "Category", options: categories.map((c) => ({ value: c, label: c })) },
      ]} />
      {note && <p className="px-4 py-2 text-[12.5px] text-muted bg-surface-2 border-b border-border">{note}</p>}
      <DataTable path="/pharmacy" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Medicine stock"
        empty={<EmptyState icon={Pill} title={q.q || q.status || q.category ? "No medicines match these filters" : "No medicines in stock yet"} description={q.status === "low" ? "Nothing is at or below its reorder level." : q.status === "expiring" ? "No stock expires within the alert window." : "Try a different search or filter."} />}
        columns={[
          { key: "name", label: "Medicine", sortable: true, render: (r) => (
            <div className="text-left">
              <Link href={`/pharmacy/medications/${r.id}`} className="font-semibold hover:text-primary">{r.genericName} {r.strength}</Link>
              {!r.isActive && <Badge tone="neutral" plain className="ml-2">Inactive</Badge>}
              <p className="text-xs text-muted">{[r.brandName, humanize(r.dosageForm), r.code].filter(Boolean).join(" · ")}</p>
            </div>
          ) },
          { key: "onHand", label: "On hand", sortable: true, align: "right", render: (r) => <span className="font-semibold tabular">{r.onHand} <span className="text-xs text-subtle font-normal">{r.unit}</span></span> },
          { key: "reorderLevel", label: "Reorder at", sortable: true, align: "right", render: (r) => r.reorderLevel },
          { key: "level", label: "Level", render: (r) => LEVEL_BADGE[stockLevel(r.onHand, r.reorderLevel)] },
          { key: "nextExpiry", label: "Next expiry", sortable: true, render: (r) => {
            if (!r.nextExpiry) return "—";
            const cls = classifyExpiry(r.nextExpiry, ctx.today, ctx.alertDays);
            return <span className="inline-flex items-center gap-2">{formatDateOnly(r.nextExpiry)}{cls === "EXPIRING" && <Badge tone="warning" plain>{daysUntil(r.nextExpiry, ctx.today)} d</Badge>}</span>;
          } },
          { key: "expiredQty", label: "Expired qty", align: "right", render: (r) => (r.expiredQty > 0 ? <span className="text-danger font-semibold tabular">{r.expiredQty}</span> : <span className="text-subtle">—</span>) },
          { key: "batchCount", label: "Batches", align: "right", render: (r) => r.batchCount },
        ]} />
      <Pagination path="/pharmacy" params={params} meta={meta} />
    </>
  );
}

async function CatalogueTab({ sp, ctx, canManage, categories }) {
  const q = parse(catalogueQuery, sp, { sort: "name", dir: "asc" });
  const { rows, meta } = await listCatalogue(q);
  const params = { tab: "catalogue", q: q.q, status: q.status, form: q.form, sort: q.sort, dir: q.dir };
  return (
    <>
      <FilterBar key="catalogue" placeholder="Search code, name, brand, manufacturer…" filters={[
        { name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
        { name: "form", label: "Form", options: DOSAGE_FORMS.map((f) => ({ value: f, label: humanize(f) })) },
      ]} />
      <DataTable path="/pharmacy" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Medication catalogue"
        empty={<EmptyState icon={Pill} title={q.q ? "No medicines match your search" : "The catalogue is empty"} description={q.q ? "Search by code, generic or brand name." : "Add medicines so doctors can prescribe them."}
          action={canManage && !q.q && <AddMedicationButton categories={categories} variant="primary" />} />}
        columns={[
          { key: "code", label: "Code", sortable: true, render: (r) => <span className="font-mono text-[12.5px] font-semibold">{r.code}</span> },
          { key: "name", label: "Medicine", sortable: true, render: (r) => (
            <div className="text-left"><Link href={`/pharmacy/medications/${r.id}`} className="font-semibold hover:text-primary">{r.genericName}</Link>{r.brandName && <p className="text-xs text-muted">{r.brandName}</p>}</div>
          ) },
          { key: "strength", label: "Strength / form", render: (r) => `${r.strength} · ${humanize(r.dosageForm)}` },
          { key: "category", label: "Category", render: (r) => r.category || "—" },
          { key: "manufacturer", label: "Manufacturer", render: (r) => r.manufacturer || "—" },
          { key: "price", label: "Price / unit", sortable: true, align: "right", render: (r) => <span className="tabular">{formatMoney(r.sellingPrice, ctx.currency)} <span className="text-xs text-subtle">/{r.unit}</span></span> },
          { key: "reorderLevel", label: "Reorder at", sortable: true, align: "right", render: (r) => r.reorderLevel },
          { key: "isActive", label: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
          ...(canManage ? [{ key: "act", label: "", align: "right", render: (r) => (
            <div className="flex justify-end gap-1">
              <EditMedicationButton medication={serialize(r)} categories={categories} size="sm" variant="ghost" />
              <ActiveToggleButton endpoint={`/api/pharmacy/medications/${r.id}/active`} isActive={r.isActive} noun="medication" size="sm"
                deactivateMessage="Inactive medicines cannot be prescribed or receive new stock. Existing stock can still be dispensed and history is preserved." />
            </div>
          ) }] : []),
        ]} />
      <Pagination path="/pharmacy" params={params} meta={meta} />
    </>
  );
}

async function LedgerTab({ sp, ctx }) {
  const q = parse(medLedgerQuery, sp, { dir: "desc" });
  const [{ rows, meta }, meds] = await Promise.all([listMedicationLedger(q, ctx.tz), medicationOptions()]);
  const params = { tab: "ledger", q: q.q, type: q.type, medicationId: q.medicationId, from: q.from, to: q.to, dir: q.dir };
  return (
    <>
      <FilterBar key="ledger" placeholder="Search medicine, batch, reason or Rx no.…" dateRange exportHref="/api/pharmacy/ledger/export" filters={[
        { name: "type", label: "Type", options: MED_MOVEMENT_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
        { name: "medicationId", label: "Medicine", options: meds.map((m) => ({ value: m.id, label: `${m.genericName} ${m.strength} (${m.code})` })) },
      ]} />
      <MedicationLedgerTable rows={rows} tz={ctx.tz} />
      <Pagination path="/pharmacy" params={params} meta={meta} />
    </>
  );
}
