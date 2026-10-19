import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Mail, MapPin, Phone, Plus, Wallet, PackageCheck, Pill, Info } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { getSupplier } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";
import { formatMoney } from "@/lib/utils/money";
import { formatDate, formatDateOnly } from "@/lib/utils/time";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { MetricCard } from "@/components/ui/MetricCard";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { EditSupplierButton } from "@/components/inventory/SupplierForm";
import { ActiveToggleButton } from "@/components/inventory/common";
import { PoStatusBadge } from "@/components/inventory/LedgerTable";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }) {
  const session = await requirePageSession("inventory:read");
  const { id } = await params;
  const canPharmacy = can(session, "pharmacy:read");
  const [s, h] = await Promise.all([getSupplier(id, { includePharmacy: canPharmacy }), getHospital()]);
  if (!s) notFound();
  const canManage = can(session, "inventory:manage");
  const money = (v) => formatMoney(v, h.currency);
  const t = s.totals;

  return (
    <>
      <Link href="/inventory?tab=suppliers" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft size={14} aria-hidden /> Suppliers</Link>
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[21px] font-bold tracking-tight">{s.name}</h1>
              <StatusBadge status={s.isActive ? "ACTIVE" : "INACTIVE"} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted">
              {s.phone && <span className="inline-flex items-center gap-1"><Phone size={13} aria-hidden />{s.phone}</span>}
              {s.email && <span className="inline-flex items-center gap-1"><Mail size={13} aria-hidden />{s.email}</span>}
              {s.address && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{s.address}</span>}
              {!s.phone && !s.email && !s.address && <span>No contact details recorded</span>}
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {s.isActive && <Button variant="primary" icon={Plus} href={`/inventory/purchase-orders/new?supplierId=${s.id}`}>New purchase order</Button>}
              <EditSupplierButton supplier={{ id: s.id, name: s.name, phone: s.phone, email: s.email, address: s.address }} />
              <ActiveToggleButton endpoint={`/api/suppliers/${s.id}/active`} isActive={s.isActive} noun="supplier"
                deactivateMessage="Inactive suppliers cannot be chosen for new purchase orders or stock receipts. Purchase history is preserved." />
            </div>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-2 ${canPharmacy ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-3 sm:gap-4 mb-3`}>
        <MetricCard label="Purchase orders" value={t.poCount} icon={FileText} hint={`${t.receivedCount} received`} />
        <MetricCard label="Total received value" value={money(t.receivedValue)} icon={PackageCheck} tone="success" hint="Received purchase orders" />
        <MetricCard label="Open orders" value={money(t.openValue)} icon={Wallet} tone="info" hint={`${t.openCount} draft or ordered`} />
        {canPharmacy && <MetricCard label="Pharmacy receipts value" value={money(t.pharmacyReceivedValue)} icon={Pill} tone="teal" hint={`${t.pharmacyBatches} medicine batch${t.pharmacyBatches === 1 ? "" : "es"}`} />}
      </div>
      <p className="text-[12.5px] text-muted mb-5 flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" aria-hidden />Values are what was received, not what is owed — supplier invoices, payments and balances are not tracked in this system yet.</p>

      <Card title="Purchase history" description="Latest 50 purchase orders." noPadding className="mb-5"
        actions={t.poCount > 50 && <Link className="text-[12.5px] font-semibold text-primary hover:underline" href={`/inventory?tab=purchase-orders&supplierId=${s.id}`}>View all</Link>}>
        <DataTable rows={s.orders} caption="Purchase orders" empty={<EmptyState icon={FileText} title="No purchase orders yet" />}
          columns={[
            { key: "po", label: "PO no.", render: (r) => <Link href={`/inventory/purchase-orders/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.poNumber}</Link> },
            { key: "lines", label: "Lines", align: "right", render: (r) => r._count.items },
            { key: "total", label: "Total", align: "right", render: (r) => <span className="font-semibold tabular">{money(r.total)}</span> },
            { key: "status", label: "Status", render: (r) => <PoStatusBadge status={r.status} /> },
            { key: "created", label: "Created", render: (r) => formatDate(r.createdAt, h.timezone) },
            { key: "received", label: "Received", render: (r) => (r.receivedAt ? formatDate(r.receivedAt, h.timezone) : "—") },
          ]} />
      </Card>

      {canPharmacy && (
        <Card title="Medicine batches supplied" description="Most recent 20 pharmacy batches from this supplier." noPadding>
          <DataTable rows={s.recentBatches} caption="Medicine batches" empty={<EmptyState icon={Pill} title="No medicine batches from this supplier" />}
            columns={[
              { key: "med", label: "Medicine", render: (b) => <Link href={`/pharmacy/medications/${b.medication.id}`} className="font-medium hover:text-primary">{b.medication.genericName} {b.medication.strength}</Link> },
              { key: "batch", label: "Batch", render: (b) => <span className="font-mono text-[12.5px]">{b.batchNo}</span> },
              { key: "exp", label: "Expiry", render: (b) => formatDateOnly(b.expiryDate) },
              { key: "cost", label: "Unit cost", align: "right", render: (b) => money(b.purchaseCost) },
              { key: "qty", label: "On hand", align: "right", render: (b) => b.quantity },
              { key: "rec", label: "Received", render: (b) => formatDate(b.receivedAt, h.timezone) },
            ]} />
        </Card>
      )}
    </>
  );
}
