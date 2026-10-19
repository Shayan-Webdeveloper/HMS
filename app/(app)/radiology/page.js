import Link from "next/link";
import { ScanLine, CalendarClock, Activity, FileClock, BadgeCheck, Plus, Inbox } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { imagingListQuery, IMAGING_STATUSES, IMAGING_STATUS_LABELS, modalityLabel } from "@/lib/validation/radiology";
import { listImagingStudies, imagingWorklistCounts, imagingModalitiesInUse } from "@/lib/services/radiology";
import { getHospital } from "@/lib/services/settings";
import { ageFromDob, formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { DataTable, Pagination, buildHref } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { StatusTabs } from "@/components/laboratory/StatusTabs";
import { AutoRefresh } from "@/components/laboratory/AutoRefresh";
import { RadiologyNav } from "@/components/radiology/RadiologyNav";

export const metadata = { title: "Radiology & Imaging" };

const TAB_KEYS = ["ACTIVE", ...IMAGING_STATUSES, "ALL"];

export default async function RadiologyPage({ searchParams }) {
  const session = await requirePageSession("radiology:read");
  const sp = await searchParams;
  const parsed = imagingListQuery.safeParse(sp);
  const q = parsed.success ? parsed.data : imagingListQuery.parse({});
  const status = TAB_KEYS.includes(sp.status) ? sp.status : "ACTIVE";
  const h = await getHospital();
  const tz = h.timezone;
  const [{ rows, meta }, counts, modalities] = await Promise.all([
    listImagingStudies({ ...q, status }, tz),
    imagingWorklistCounts(tz),
    imagingModalitiesInUse(),
  ]);
  const sort = q.sort && ["studyNo", "createdAt", "scheduledAt", "modality"].includes(q.sort) ? q.sort : "createdAt";
  const params = { q: q.q, status, modality: q.modality, from: q.from, to: q.to, sort: sp.sort, dir: sp.dir };
  const filterParams = { q: q.q, modality: q.modality, from: q.from, to: q.to };
  const tabs = TAB_KEYS.map((k) => ({
    key: k,
    label: k === "ACTIVE" ? "Active" : k === "ALL" ? "All" : IMAGING_STATUS_LABELS[k],
    count: k === "ACTIVE" ? counts.active : k === "ALL" ? counts.all : counts.status[k],
  }));
  const href = (st) => buildHref("/radiology", { ...filterParams, status: st });

  return (
    <>
      <PageHeader title="Radiology & Imaging" description="Imaging requests, scheduling, reporting and verification."
        actions={can(session, "radiology:order") && <Button variant="primary" icon={Plus} href="/radiology/new">New imaging request</Button>} />
      <RadiologyNav active="worklist" showCatalog={can(session, ["radiology:verify", "settings:manage"])} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
        <MetricCard label="Awaiting scheduling" value={counts.status.REQUESTED} icon={Inbox} tone="info" href={href("REQUESTED")} />
        <MetricCard label="Scheduled today" value={counts.scheduledToday} icon={CalendarClock} tone="primary" href={href("SCHEDULED")} hint={`${counts.status.SCHEDULED} scheduled in total`} />
        <MetricCard label="In progress" value={counts.status.IN_PROGRESS} icon={Activity} tone="teal" href={href("IN_PROGRESS")} />
        <MetricCard label="Awaiting verification" value={counts.status.REPORTED} icon={FileClock} tone="warning" href={href("REPORTED")} />
        <MetricCard label="Verified today" value={counts.verifiedToday} icon={BadgeCheck} tone="success" href={href("VERIFIED")} />
      </div>

      <div className="card">
        <StatusTabs tabs={tabs} active={status} path="/radiology" params={filterParams} />
        <FilterBar placeholder="Search study no., examination, patient name or MRN…" dateRange
          filters={[{ name: "modality", label: "Modality", options: modalities.map((m) => ({ value: m, label: modalityLabel(m) })) }]} />
        <DataTable path="/radiology" params={params} sort={sort} dir={q.dir} rows={rows} caption="Imaging studies"
          empty={<EmptyState icon={ScanLine} title={q.q || q.modality || q.from || q.to ? "No studies match your filters" : status === "ACTIVE" ? "No active imaging studies" : "No studies in this status"}
            description="New imaging requests appear here as soon as they are placed."
            action={can(session, "radiology:order") && <Button variant="primary" icon={Plus} href="/radiology/new">New imaging request</Button>} />}
          columns={[
            { key: "studyNo", label: "Study", sortable: true, render: (r) => <Link href={`/radiology/${r.id}`} className="font-mono text-[12.5px] font-semibold text-primary hover:underline">{r.studyNo}</Link> },
            { key: "patient", label: "Patient", render: (r) => (
              <div>
                <Link href={`/radiology/${r.id}`} className="font-medium hover:text-primary">{r.patient.firstName} {r.patient.lastName}</Link>
                <p className="text-xs text-muted"><span className="font-mono">{r.patient.mrn}</span> · {r.patient.dateOfBirth ? `${ageFromDob(r.patient.dateOfBirth)} y` : "—"} · {r.patient.sex && r.patient.sex !== "UNKNOWN" ? r.patient.sex[0] : "—"}</p>
              </div>
            ) },
            { key: "modality", label: "Examination", sortable: true, render: (r) => <div><Badge tone="primary" plain>{modalityLabel(r.modality)}</Badge><p className="text-[13px] mt-0.5">{r.bodyPart}</p></div> },
            { key: "requestedBy", label: "Requested by", render: (r) => r.requestedByName || "—" },
            { key: "createdAt", label: "Requested", sortable: true, render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt, tz)}</span> },
            { key: "scheduledAt", label: "Scheduled", sortable: true, render: (r) => <span className="whitespace-nowrap">{r.scheduledAt ? formatDateTime(r.scheduledAt, tz) : "—"}</span> },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} label={IMAGING_STATUS_LABELS[r.status]} /> },
          ]} />
        <Pagination path="/radiology" params={params} meta={meta} />
      </div>
      <div className="mt-3"><AutoRefresh seconds={60} /></div>
    </>
  );
}
