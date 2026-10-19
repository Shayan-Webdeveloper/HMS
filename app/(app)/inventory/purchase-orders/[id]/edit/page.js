import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getPurchaseOrder, itemOptions, lookupSuppliers } from "@/lib/services/inventory";
import { getHospital } from "@/lib/services/settings";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { PurchaseOrderForm } from "@/components/inventory/PurchaseOrderForm";

export const metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrderPage({ params }) {
  await requirePageSession("inventory:manage");
  const { id } = await params;
  const po = await getPurchaseOrder(id);
  if (!po) notFound();
  if (po.status !== "DRAFT") redirect(`/inventory/purchase-orders/${id}`);
  const [suppliers, items, h] = await Promise.all([lookupSuppliers({ pageSize: 500 }), itemOptions({ activeOnly: true }), getHospital()]);
  return (
    <div className="max-w-5xl">
      <PageHeader title={`Edit ${po.poNumber}`} description={`Draft for ${po.supplier.name}. Changes are allowed until the order is marked as ordered.`} />
      <Card>
        <PurchaseOrderForm suppliers={suppliers} items={serialize(items)} currency={h.currency}
          po={serialize({ id: po.id, supplierId: po.supplierId, items: po.items.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity, unitCost: l.unitCost })) })} />
      </Card>
    </div>
  );
}
