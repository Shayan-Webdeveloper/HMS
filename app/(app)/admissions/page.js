import Link from "next/link";
import { UserPlus, BedDouble, LogIn, LogOut } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listQuery } from "@/lib/validation/common";
import { admissionListQuery, formatLos, doctorName } from "@/lib/validation/inpatient";
import { listAdmissions, listWardFilterOptions } from "@/lib/services/admissions";
import { getHospital } from "@/lib/services/settings";
import { formatDateTime, formatDate, todayInTz, dayRangeUtc } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { MetricCard } from "@/components/ui/MetricCard";
import { LinkTabs } from "@/components/ui/Tabs";

export const metadata = { title: "Admissions" };

export default async function AdmissionsPage({ searchParams }) {
  const session = await requirePageSession("admissions:read");
  const sp = await searchParams;
  const base = listQuery.safeParse({ ...sp, sort: sp.sort || "admittedAt" });
  const q = base.success ? base.data : listQuery.parse({ sort: "admittedAt" });
  const ex = admissionListQuery.safeParse(sp);
  const status = (ex.success && ex.data.status) || "ADMITTED";
  const wardId = ex.success ? ex.data.wardId : undefined;
  const h = await getHospital();
  const tz = h.timezone;
  const [today0, today1] = dayRangeUtc(todayInTz(tz), tz);
  const [{ rows, meta }, wards, current, admittedToday, dischargedToday] = await Promise.all([
    listAdmissions({ ...q, status, wardId }),
    listWardFilterOptions(),
    prisma.admission.count({ where: { status: "ADMITTED" } }),
    prisma.admission.count({ where: { admittedAt: { gte: today0, lt: today1 } } }),
    prisma.admission.count({ where: { status: "DISCHARGED", dischargedAt: { gte: today0, lt: today1 } } }),
  ]);
  const params = { q: q.q, status: sp.status, wardId, sort: q.sort, dir: q.dir };
  const canCreate = can(session, "admissions:create");

  return (
    <>
      <PageHeader title="IPD & admissions" description="Inpatients, bed assignments, transfers and discharges."
        actions={<>
          {can(session, "wards:read") && <Button icon={BedDouble} href="/wards">Bed board</Button>}
          {canCreate && <Button variant="primary" icon={UserPlus} href="/admissions/new">Admit patient</Button>}
        </>} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <MetricCard label="Current inpatients" value={current} icon={BedDouble} tone="primary" href="/admissions" />
        <MetricCard label="Admitted today" value={admittedToday} icon={LogIn} tone="teal" />
        <MetricCard label="Discharged today" value={dischargedToday} icon={LogOut} tone="success" href="/admissions?status=DISCHARGED" />
      </div>
      <div className="card">
        <LinkTabs param="status" baseHref="/admissions" active={status}
          tabs={[{ key: "ADMITTED", label: "Current inpatients", count: current }, { key: "DISCHARGED", label: "Discharged" }, { key: "ALL", label: "All admissions" }]} />
        <FilterBar placeholder="Search admission no., patient name, MRN or phone…"
          filters={[{ name: "wardId", label: "Ward", options: wards.map((w) => ({ value: w.id, label: w.name })) }]} />
        <DataTable path="/admissions" params={params} sort={q.sort} dir={q.dir} rows={rows} caption="Admissions"
          empty={<EmptyState icon={BedDouble} title={q.q || wardId ? "No admissions match" : status === "ADMITTED" ? "No current inpatients" : "No admissions"}
            description={q.q || wardId ? "Try a different search or ward." : "Admitted patients appear here."}
            action={canCreate && <Button variant="primary" icon={UserPlus} href="/admissions/new">Admit patient</Button>} />}
          columns={[
            { key: "admissionNo", label: "Admission", sortable: true, render: (r) => <Link href={`/admissions/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.admissionNo}</Link> },
            { key: "patient", label: "Patient", render: (r) => <Link href={`/admissions/${r.id}`} className="hover:text-primary"><span className="font-medium">{r.patient.firstName} {r.patient.lastName}</span><span className="block text-xs text-muted">{r.patient.mrn}</span></Link> },
            { key: "bed", label: r0(status), render: (r) => { const b = r.bedAssignments[0]; return b ? <span>{b.bed.ward.name}<span className="block text-xs text-muted font-mono">{b.bed.label}{b.endedAt ? " (last)" : ""}</span></span> : "—"; } },
            { key: "doctor", label: "Doctor", render: (r) => doctorName(r.doctor) },
            { key: "admittedAt", label: "Admitted", sortable: true, render: (r) => formatDateTime(r.admittedAt, tz) },
            { key: "los", label: "LOS", render: (r) => formatLos(r.admittedAt, r.dischargedAt, tz) },
            status === "ADMITTED"
              ? { key: "expectedDischargeAt", label: "Expected discharge", sortable: true, render: (r) => (r.expectedDischargeAt ? formatDate(r.expectedDischargeAt, tz) : "—") }
              : { key: "dischargedAt", label: "Discharged", sortable: true, render: (r) => formatDateTime(r.dischargedAt, tz) },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        <Pagination path="/admissions" params={params} meta={meta} />
      </div>
    </>
  );
}

function r0(status) {
  return status === "ADMITTED" ? "Ward / bed" : "Ward / bed (last)";
}
