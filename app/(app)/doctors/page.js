import Link from "next/link";
import { UserPlus, Stethoscope } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { doctorListQuery, parseQuery } from "@/lib/validation/staff";
import { listDoctors } from "@/lib/services/staff";
import { listDepartmentOptions } from "@/lib/services/departments";
import { getHospital } from "@/lib/services/settings";
import { formatMoney } from "@/lib/utils/money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";

export const metadata = { title: "Doctors" };

export default async function DoctorsPage({ searchParams }) {
  const session = await requirePageSession("staff:read");
  const sp = await searchParams;
  const q = parseQuery(doctorListQuery, { ...sp, sort: sp.sort || "name", dir: sp.dir || "asc" });
  const status = ["ACTIVE", "INACTIVE"].includes(q.status) ? q.status : undefined;
  const h = await getHospital();
  const [{ rows, meta }, departments] = await Promise.all([
    listDoctors({ ...q, status }),
    listDepartmentOptions({ includeInactive: true }),
  ]);
  const params = { q: q.q, departmentId: q.departmentId, status, accepting: q.accepting, sort: q.sort, dir: q.dir };
  const canManage = can(session, "staff:manage");
  const filtered = q.q || q.departmentId || status || q.accepting;

  return (
    <>
      <PageHeader title="Doctors" description="Directory of doctors, consultation fees, slot lengths and booking availability."
        actions={canManage && <Button variant="primary" icon={UserPlus} href="/doctors/new">Add doctor</Button>} />
      <div className="card">
        <FilterBar placeholder="Search name, specialty or license no…"
          filters={[
            { name: "departmentId", label: "Department", options: departments.map((d) => ({ value: d.id, label: d.isActive ? d.name : `${d.name} (inactive)` })) },
            { name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
            { name: "accepting", label: "Bookings", options: [{ value: "yes", label: "Accepting" }, { value: "no", label: "Not accepting" }] },
          ]} />
        <DataTable
          path="/doctors" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Doctors"
          empty={<EmptyState icon={Stethoscope} title={filtered ? "No doctors match these filters" : "No doctors yet"}
            description={filtered ? "Try a different name, specialty or department." : "Add doctors to start scheduling appointments."}
            action={canManage && !filtered && <Button variant="primary" icon={UserPlus} href="/doctors/new">Add doctor</Button>} />}
          columns={[
            { key: "name", label: "Doctor", sortable: true, render: (d) => (
              <Link href={`/doctors/${d.id}`} className="flex items-center gap-3 group text-left">
                <span className="w-8 h-8 rounded-full bg-primary-soft text-primary-ink text-[12px] font-bold flex items-center justify-center shrink-0" aria-hidden>{d.staff.firstName[0]}{d.staff.lastName[0]}</span>
                <span className="min-w-0">
                  <span className="block font-medium group-hover:text-primary">Dr. {d.staff.firstName} {d.staff.lastName}</span>
                  <span className="block text-xs text-muted font-mono">{d.staff.employeeNo} · {d.licenseNumber}</span>
                </span>
              </Link>
            ) },
            { key: "specialty", label: "Specialty", sortable: true, render: (d) => d.specialty },
            { key: "department", label: "Department", sortable: true, render: (d) => <>{d.department.name}{!d.department.isActive && <Badge tone="neutral" plain className="ml-1.5">inactive</Badge>}</> },
            { key: "fee", label: "Fee", sortable: true, align: "right", render: (d) => formatMoney(d.consultationFee, h.currency) },
            { key: "slot", label: "Slot", sortable: true, align: "right", render: (d) => `${d.slotMinutes} min` },
            { key: "accepting", label: "Bookings", render: (d) => d.acceptsAppointments
              ? (d._count.availability ? <Badge tone="success">Accepting</Badge> : <Badge tone="warning">No hours set</Badge>)
              : <Badge tone="neutral">Closed</Badge> },
            { key: "status", label: "Status", render: (d) => <StatusBadge status={d.staff.employmentStatus} /> },
          ]}
        />
        <Pagination path="/doctors" params={params} meta={meta} />
      </div>
    </>
  );
}
