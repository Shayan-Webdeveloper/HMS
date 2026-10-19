import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getWard, listDepartmentOptions } from "@/lib/services/wards";
import { getHospital } from "@/lib/services/settings";
import { formatMoney } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { titleCase } from "@/lib/validation/inpatient";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { WardForm } from "@/components/inpatient/WardForm";
import { AddBedsDialog } from "@/components/inpatient/AddBedsDialog";
import { BedStatusActions } from "@/components/inpatient/BedStatusActions";
import { BedLegend } from "@/components/inpatient/BedBoard";

export const metadata = { title: "Ward" };

export default async function WardPage({ params }) {
  const session = await requirePageSession("wards:read");
  const { id } = await params;
  const ward = await getWard(id);
  if (!ward) notFound();
  const h = await getHospital();
  const canManage = can(session, "wards:manage");
  const canAdm = can(session, "admissions:read");
  const departments = canManage ? await listDepartmentOptions() : [];
  const activity = canManage
    ? await prisma.auditLog.findMany({ where: { entityType: "Bed", entityId: { in: ward.beds.map((b) => b.id) }, action: "bed.status" }, orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { name: true } } } })
    : [];
  const beds = ward.beds.map((b) => ({ id: b.id, label: b.label, status: b.status, admission: b.status === "OCCUPIED" ? b.assignments[0]?.admission ?? null : null }));

  return (
    <>
      <PageHeader title={ward.name} description={`${ward.code} · ${titleCase(ward.type)} · ${formatMoney(ward.dailyRate, h.currency, h.locale)} per day${ward.department ? ` · ${ward.department.name}` : ""}`}
        actions={<Button href="/wards">Back to bed board</Button>}>
        <div className="mt-2 flex gap-2">{!ward.isActive && <Badge tone="neutral">Inactive</Badge>}<Badge tone="primary" plain>{ward.stats.occupancyPct}% occupied</Badge></div>
      </PageHeader>

      <div className="grid xl:grid-cols-[1fr_420px] gap-5 items-start">
        <Card title="Beds" description={`${ward.stats.total} beds · ${ward.stats.AVAILABLE} available · ${ward.stats.OCCUPIED} occupied`} noPadding
          actions={canManage && <AddBedsDialog ward={{ id: ward.id, code: ward.code }} existingLabels={ward.beds.map((b) => b.label)} />}>
          <div className="px-4 py-3 border-b border-border"><BedLegend counts={ward.stats} /></div>
          <DataTable rows={beds} caption="Beds"
            empty={<EmptyState title="No beds yet" description={canManage ? "Use “Add beds” to create the first beds for this ward." : "Beds will appear here once added."} />}
            columns={[
              { key: "label", label: "Bed", render: (b) => <span className="font-mono font-semibold">{b.label}</span> },
              { key: "status", label: "Status", render: (b) => <StatusBadge status={b.status} /> },
              { key: "occ", label: "Occupant", render: (b) => (b.admission ? (canAdm ? <Link className="text-primary font-medium hover:underline" href={`/admissions/${b.admission.id}`}>{b.admission.patient.firstName} {b.admission.patient.lastName} · {b.admission.admissionNo}</Link> : `${b.admission.patient.firstName} ${b.admission.patient.lastName}`) : "—") },
              ...(canManage ? [{ key: "actions", label: "Actions", render: (b) => <BedStatusActions bed={{ id: b.id, label: b.label, status: b.status }} /> }] : []),
            ]} />
        </Card>

        <div className="space-y-5">
          {canManage ? (
            <Card title="Edit ward">
              <WardForm ward={serialize({ id: ward.id, name: ward.name, code: ward.code, type: ward.type, dailyRate: ward.dailyRate.toFixed(2), departmentId: ward.departmentId ?? "", isActive: ward.isActive })} departments={departments} cancelHref="/wards" />
            </Card>
          ) : (
            <Card title="Ward details">
              <dl className="dl-grid">
                <div><dt>Code</dt><dd>{ward.code}</dd></div>
                <div><dt>Type</dt><dd>{titleCase(ward.type)}</dd></div>
                <div><dt>Daily rate</dt><dd>{formatMoney(ward.dailyRate, h.currency, h.locale)}</dd></div>
                <div><dt>Department</dt><dd>{ward.department?.name || "—"}</dd></div>
                <div><dt>Facility</dt><dd>{ward.facility?.name || "—"}</dd></div>
              </dl>
            </Card>
          )}
          {canManage && (
            <Card title="Recent bed status changes" noPadding>
              {activity.length === 0 ? <EmptyState title="No status changes yet" /> : (
                <ul className="divide-y divide-border">
                  {activity.map((a) => (
                    <li key={a.id} className="px-4 py-2.5 text-[13px]">
                      <span className="font-mono font-semibold">{a.metadata?.label}</span> {titleCase(a.metadata?.from)} → <span className="font-medium">{titleCase(a.metadata?.to)}</span>
                      {a.metadata?.reason && <span className="text-muted"> — {a.metadata.reason}</span>}
                      <div className="text-xs text-subtle">{a.user?.name || "System"} · {formatDateTime(a.createdAt, h.timezone)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
