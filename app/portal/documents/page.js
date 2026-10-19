import { FileText, Download } from "lucide-react";
import { requirePortalSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { portalDocuments } from "@/lib/services/dashboard";
import { formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";

export const metadata = { title: "Documents" };

const sizeLabel = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default async function PortalDocumentsPage() {
  const session = await requirePortalSession();
  const h = await getHospital();
  const docs = await portalDocuments(session.patientId);
  return (
    <>
      <PageHeader title="My documents" description="Referral letters, reports and other files added to your record by the hospital. Downloads are logged." />
      <div className="card">
        <DataTable rows={docs} caption="Documents"
          empty={<EmptyState icon={FileText} title="No documents" description="Files the hospital adds to your record will appear here." />}
          columns={[
            { key: "name", label: "File", render: (d) => <a className="text-primary font-medium hover:underline inline-flex items-center gap-1.5" href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer"><Download size={14} aria-hidden />{d.originalName}</a> },
            { key: "category", label: "Type", render: (d) => d.category.replace(/_/g, " ").toLowerCase() },
            { key: "size", label: "Size", align: "right", render: (d) => sizeLabel(d.sizeBytes) },
            { key: "createdAt", label: "Added", render: (d) => formatDateTime(d.createdAt, h.timezone) },
          ]} />
      </div>
    </>
  );
}
