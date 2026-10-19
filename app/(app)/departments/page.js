import Link from "next/link";
import { Network } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQuery } from "@/lib/validation/common";
import { parseQuery } from "@/lib/validation/staff";
import { listDepartments } from "@/lib/services/departments";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { NewDepartmentButton, DepartmentRowActions } from "@/components/staff/DepartmentActions";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage({ searchParams }) {
  const session = await requirePageSession("staff:read");
  const sp = await searchParams;
  const q = parseQuery(listQuery, { ...sp, sort: sp.sort || "name", dir: sp.dir || "asc" });
  const status = ["ACTIVE", "INACTIVE"].includes(q.status) ? q.status : undefined;
  const { rows, meta } = await listDepartments({ ...q, status });
  const params = { q: q.q, status, sort: q.sort, dir: q.dir };
  const canManage = can(session, "staff:manage");
  const count = (n, href) => (n > 0 ? <Link href={href} className="font-semibold tabular text-primary hover:underline">{n}</Link> : <span className="tabular text-subtle">0</span>);

  return (
    <>
      <PageHeader title="Departments" description="Clinical and administrative departments with staffing, doctors and wards."
        actions={canManage && <NewDepartmentButton />} />
      <div className="card">
        <FilterBar placeholder="Search name or code…" filters={[{ name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] }]} />
        <DataTable path="/departments" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Departments"
          empty={<EmptyState icon={Network} title={q.q || status ? "No departments match" : "No departments yet"} description={q.q || status ? "Try a different search." : "Create departments to organise staff, doctors and wards."}
            action={canManage && !q.q && !status && <NewDepartmentButton />} />}
          columns={[
            { key: "name", label: "Department", sortable: true, render: (d) => (
              <div className="text-left">
                <p className="font-medium">{d.name}</p>
                {d.description && <p className="text-xs text-muted line-clamp-1 max-w-[340px]">{d.description}</p>}
              </div>
            ) },
            { key: "code", label: "Code", sortable: true, render: (d) => <span className="font-mono text-[12.5px] font-semibold">{d.code}</span> },
            { key: "type", label: "Type", render: (d) => (d.isClinical ? <Badge tone="teal" plain>Clinical</Badge> : <Badge tone="neutral" plain>Non-clinical</Badge>) },
            { key: "staff", label: "Staff", align: "right", render: (d) => count(d._count.staff, `/staff?departmentId=${d.id}`) },
            { key: "doctors", label: "Doctors", align: "right", render: (d) => count(d._count.doctors, `/doctors?departmentId=${d.id}`) },
            { key: "wards", label: "Wards", align: "right", render: (d) => <span className={`tabular ${d._count.wards ? "font-semibold" : "text-subtle"}`}>{d._count.wards}</span> },
            { key: "status", label: "Status", render: (d) => <StatusBadge status={d.isActive ? "ACTIVE" : "INACTIVE"} /> },
            ...(canManage ? [{ key: "actions", label: "", align: "right", render: (d) => (
              <DepartmentRowActions department={{ id: d.id, name: d.name, code: d.code, description: d.description, isClinical: d.isClinical, isActive: d.isActive }} />
            ) }] : []),
          ]} />
        <Pagination path="/departments" params={params} meta={meta} />
        <p className="px-4 py-2 border-t border-border text-[11.5px] text-subtle">Staff excludes terminated employees · doctors counts active or on-leave doctors · wards counts active wards.</p>
      </div>
    </>
  );
}
