import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQuery } from "@/lib/validation/common";
import { listPatients } from "@/lib/services/patients";
import { getHospital } from "@/lib/services/settings";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { ageFromDob, formatDate } from "@/lib/utils/time";

export const metadata = { title: "Patients" };

export default async function PatientsPage({ searchParams }) {
  const session = await requirePageSession("patients:read");
  const sp = await searchParams;
  // Tolerate hand-edited URLs: fall back to defaults instead of erroring.
  const parsed = listQuery.safeParse({ ...sp, sort: sp.sort || "registeredAt" });
  const q = parsed.success ? parsed.data : listQuery.parse({ sort: "registeredAt" });
  const h = await getHospital();
  const { rows, meta } = await listPatients(q, h.timezone);
  const params = { q: q.q, status: sp.status, from: sp.from, to: sp.to, sort: q.sort, dir: q.dir };

  return (
    <>
      <PageHeader title="Patients" description="Search, register and manage patient records."
        actions={can(session, "patients:create") && <Button variant="primary" icon={UserPlus} href="/patients/new">Register patient</Button>} />
      <div className="card">
        <FilterBar placeholder="Search name, MRN, phone or email…" dateRange
          filters={[{ name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "ARCHIVED", label: "Archived" }, { value: "DECEASED", label: "Deceased" }, { value: "ALL", label: "All (incl. archived)" }] }]}
          exportHref={can(session, "patients:export") ? "/api/patients/export" : undefined} />
        <DataTable
          path="/patients" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Patients"
          empty={<EmptyState title={q.q ? "No patients match your search" : "No patients yet"} description={q.q ? "Check the spelling, or search by MRN or phone." : "Registered patients will appear here."}
            action={can(session, "patients:create") && <Button variant="primary" icon={UserPlus} href="/patients/new">Register patient</Button>} />}
          columns={[
            { key: "mrn", label: "MRN", sortable: true, render: (r) => <Link href={`/patients/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.mrn}</Link> },
            { key: "name", label: "Name", sortable: true, render: (r) => (
              <Link href={`/patients/${r.id}`} className="font-medium hover:text-primary">{r.firstName} {r.lastName}{r._count.allergies > 0 && <Badge tone="danger" plain className="ml-2">Allergy</Badge>}</Link>
            ) },
            { key: "dateOfBirth", label: "Age / Sex", sortable: true, render: (r) => `${r.dateOfBirth ? ageFromDob(r.dateOfBirth) + " y" : "—"} · ${r.sex === "UNKNOWN" ? "—" : r.sex[0] + r.sex.slice(1).toLowerCase()}` },
            { key: "phone", label: "Phone", render: (r) => r.phone || "—" },
            { key: "city", label: "City", render: (r) => r.city || "—" },
            { key: "registeredAt", label: "Registered", sortable: true, render: (r) => formatDate(r.registeredAt, h.timezone) },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        <Pagination path="/patients" params={params} meta={meta} />
      </div>
    </>
  );
}
