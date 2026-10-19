import { requirePageSession, can } from "@/lib/auth/session";
import { getImagingCatalog, getImagingCatalogMeta } from "@/lib/services/radiology";
import { getHospital } from "@/lib/services/settings";
import { formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { RadiologyNav } from "@/components/radiology/RadiologyNav";
import { CatalogEditor } from "@/components/radiology/CatalogEditor";
import { Plus } from "lucide-react";

export const metadata = { title: "Imaging catalogue" };

export default async function ImagingCatalogPage() {
  const session = await requirePageSession(["radiology:verify", "settings:manage"]);
  const h = await getHospital();
  const [items, meta] = await Promise.all([getImagingCatalog(), getImagingCatalogMeta()]);
  return (
    <>
      <PageHeader title="Radiology & Imaging" description="Examinations clinicians can request, with modality and price."
        actions={can(session, "radiology:order") && <Button variant="primary" icon={Plus} href="/radiology/new">New imaging request</Button>} />
      <RadiologyNav active="catalog" showCatalog />
      <div className="card">
        <header className="card-header">
          <div>
            <h2 className="card-title">Imaging catalogue</h2>
            <p className="text-xs text-muted mt-0.5">{meta.updatedAt ? `Last changed ${formatDateTime(meta.updatedAt, h.timezone)}${meta.updatedByName ? ` by ${meta.updatedByName}` : ""}` : "Not yet customised"}</p>
          </div>
        </header>
        <CatalogEditor key={meta.updatedAt ? new Date(meta.updatedAt).toISOString() : "initial"} items={items} canEdit currency={h.currency} />
      </div>
    </>
  );
}
