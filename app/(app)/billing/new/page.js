import { requirePageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getHospital } from "@/lib/services/settings";
import { getBillingSettings, getServiceCatalog } from "@/lib/services/billing";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { NewInvoiceForm } from "@/components/billing/NewInvoiceForm";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }) {
  await requirePageSession("billing:create");
  const sp = await searchParams;
  const [h, settings, catalog] = await Promise.all([getHospital(), getBillingSettings(), getServiceCatalog()]);
  let initial = null;
  if (typeof sp.patientId === "string" && sp.patientId) {
    const p = await prisma.patient.findUnique({ where: { id: sp.patientId }, select: { id: true, mrn: true, firstName: true, lastName: true, phone: true, status: true } });
    // Same shape as EntityPicker's mapPatient (client module, so not callable here).
    if (p && p.status !== "MERGED") initial = { id: p.id, label: `${p.firstName} ${p.lastName}`, sub: [p.mrn, p.phone].filter(Boolean).join(" · ") };
  }
  return (
    <div className="max-w-5xl">
      <PageHeader title="New invoice" description="Pick unbilled charges and services. The invoice is saved as a draft so you can review discounts before issuing." />
      <Card>
        <NewInvoiceForm initialPatient={initial} catalog={catalog} taxRate={settings.taxRatePercent} currency={h.currency} locale={h.locale} tz={h.timezone} />
      </Card>
    </div>
  );
}
