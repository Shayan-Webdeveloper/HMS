import { requirePageSession } from "@/lib/auth/session";
import { itemOptions, lookupSuppliers } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { PurchaseOrderForm } from "@/components/inventory/PurchaseOrderForm";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage({ searchParams }) {
  await requirePageSession("inventory:manage");
  const sp = await searchParams;
  const [suppliers, items, h] = await Promise.all([lookupSuppliers({ pageSize: 500 }), itemOptions({ activeOnly: true }), getHospital()]);
  const preset = suppliers.some((s) => s.id === sp.supplierId) ? sp.supplierId : undefined;
  return (
    <div className="max-w-5xl">
      <PageHeader title="New purchase order" description="Saved as a draft. A PO number is assigned automatically; edit freely until it is marked as ordered." />
      <Card><PurchaseOrderForm suppliers={suppliers} items={serialize(items)} currency={h.currency} defaultSupplierId={preset} /></Card>
    </div>
  );
}
