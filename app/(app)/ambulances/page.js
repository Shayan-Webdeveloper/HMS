import Link from "next/link";
import { Ambulance, CheckCircle2, Send, Wrench, Info, Phone } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { listQuery } from "@/lib/validation/common";
import { DISPATCH_STATUSES, AMBULANCE_STATUSES, erLabel } from "@/lib/validation/emergency";
import { listAmbulances, listDispatches, fleetSummary } from "@/lib/services/ambulances";
import { listOpenVisitOptions } from "@/lib/services/emergency";
import { getHospital } from "@/lib/services/settings";
import { formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { LinkTabs } from "@/components/ui/Tabs";
import { FilterBar } from "@/components/ui/FilterBar";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { AddAmbulanceButton, AmbulanceRowActions, NewDispatchButton, DispatchActions } from "@/components/emergency/AmbulanceControls";

export const metadata = { title: "Ambulances" };

export default async function AmbulancesPage({ searchParams }) {
  const session = await requirePageSession("ambulance:read");
  const sp = await searchParams;
  const tab = sp.tab === "dispatches" ? "dispatches" : "fleet";
  const h = await getHospital();
  const canManage = can(session, "ambulance:manage");
  const canEr = can(session, "emergency:read");
  const summary = await fleetSummary();
  const available = canManage ? (await listAmbulances({ status: "AVAILABLE" })).map((a) => ({ id: a.id, vehicleNo: a.vehicleNo, type: a.type, driverName: a.driverName })) : [];
  const visits = canManage && canEr ? await listOpenVisitOptions() : null;
  const dispatchFor = typeof sp.dispatchFor === "string" && visits?.some((v) => v.id === sp.dispatchFor) ? sp.dispatchFor : undefined;

  return (
    <>
      <PageHeader title="Ambulances" description="Fleet status and dispatch tracking."
        actions={canManage && <>
          <NewDispatchButton ambulances={available} visits={visits} initialVisitId={dispatchFor} autoOpen={!!dispatchFor} />
          <AddAmbulanceButton />
        </>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <MetricCard label="Fleet size" value={summary.total} icon={Ambulance} tone="primary" />
        <MetricCard label="Available" value={summary.AVAILABLE} icon={CheckCircle2} tone="success" />
        <MetricCard label="On dispatch" value={summary.DISPATCHED} icon={Send} tone="info" href="/ambulances?tab=dispatches&status=ACTIVE" />
        <MetricCard label="In maintenance" value={summary.MAINTENANCE} icon={Wrench} tone="warning" />
      </div>
      <p className="mb-4 text-[12.5px] text-muted inline-flex items-start gap-2"><Info size={14} className="mt-0.5 shrink-0" aria-hidden />Live GPS vehicle tracking is an optional integration and is not included. Dispatch status is updated manually by the control desk.</p>
      <div className="card">
        <LinkTabs baseHref="/ambulances" active={tab} tabs={[{ key: "fleet", label: "Fleet", count: summary.total }, { key: "dispatches", label: "Dispatches" }]} />
        {tab === "fleet" ? <Fleet sp={sp} canManage={canManage} tz={h.timezone} /> : <Dispatches sp={sp} canManage={canManage} canEr={canEr} tz={h.timezone} />}
      </div>
    </>
  );
}

async function Fleet({ sp, canManage, tz }) {
  const status = AMBULANCE_STATUSES.includes(sp.status) ? sp.status : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const rows = await listAmbulances({ q, status });
  return (
    <>
      <FilterBar placeholder="Search vehicle no. or driver…" filters={[{ name: "status", label: "Status", options: AMBULANCE_STATUSES.map((s) => ({ value: s, label: erLabel(s) })) }]} />
      <DataTable rows={rows} caption="Ambulance fleet"
        empty={<EmptyState icon={Ambulance} title={q || status ? "No vehicles match" : "No ambulances yet"} description={canManage ? "Add the first vehicle to start dispatching." : undefined} />}
        columns={[
          { key: "vehicleNo", label: "Vehicle", render: (a) => <span className="font-semibold">{a.vehicleNo}</span> },
          { key: "type", label: "Type", render: (a) => <Badge tone={a.type === "ALS" ? "teal" : "neutral"} plain>{a.type}</Badge> },
          { key: "driver", label: "Driver", render: (a) => (a.driverName ? <span>{a.driverName}{a.driverPhone && <span className="block text-xs text-muted inline-flex items-center gap-1"><Phone size={11} aria-hidden />{a.driverPhone}</span>}</span> : "—") },
          { key: "status", label: "Status", render: (a) => <StatusBadge status={a.status === "MAINTENANCE" ? "OUT_OF_SERVICE" : a.status === "DISPATCHED" ? "IN_PROGRESS" : "AVAILABLE"} label={erLabel(a.status)} /> },
          { key: "current", label: "Current job", render: (a) => (a.dispatches[0] ? <Link className="text-primary hover:underline" href="/ambulances?tab=dispatches&status=ACTIVE">{erLabel(a.dispatches[0].status)} → {a.dispatches[0].destination}<span className="block text-xs text-muted">since {formatDateTime(a.dispatches[0].dispatchedAt, tz)}</span></Link> : "—") },
          { key: "actions", label: "", align: "right", render: (a) => <AmbulanceRowActions ambulance={{ id: a.id, vehicleNo: a.vehicleNo, type: a.type, driverName: a.driverName, driverPhone: a.driverPhone, status: a.status }} canManage={canManage} /> },
        ]} />
    </>
  );
}

async function Dispatches({ sp, canManage, canEr, tz }) {
  const parsed = listQuery.safeParse(sp);
  const q = parsed.success ? parsed.data : listQuery.parse({});
  const status = [...DISPATCH_STATUSES, "ACTIVE"].includes(sp.status) ? sp.status : undefined;
  const { rows, meta } = await listDispatches({ ...q, status }, tz);
  const params = { tab: "dispatches", q: q.q, status, from: q.from, to: q.to };
  return (
    <>
      <FilterBar placeholder="Search address, caller, vehicle or ER visit…" dateRange
        filters={[{ name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active (not closed)" }, ...DISPATCH_STATUSES.map((s) => ({ value: s, label: erLabel(s) }))] }]} />
      <DataTable rows={rows} caption="Ambulance dispatches"
        empty={<EmptyState icon={Send} title="No dispatches" description="Dispatches appear here once an ambulance is sent." />}
        columns={[
          { key: "when", label: "Dispatched", render: (d) => formatDateTime(d.dispatchedAt, tz) },
          { key: "amb", label: "Vehicle", render: (d) => <span className="font-semibold">{d.ambulance.vehicleNo}</span> },
          { key: "route", label: "Pickup → destination", render: (d) => <span className="max-w-[300px] inline-block">{d.pickupAddress} <span className="text-muted">→</span> {d.destination}</span> },
          { key: "caller", label: "Caller", render: (d) => (d.callerName || d.callerPhone ? <span>{d.callerName || "—"}{d.callerPhone && <span className="block text-xs text-muted">{d.callerPhone}</span>}</span> : "—") },
          { key: "er", label: "ER visit", render: (d) => (d.emergencyVisit ? (canEr ? <Link className="font-mono text-[12.5px] text-primary hover:underline" href={`/emergency/${d.emergencyVisit.id}`}>{d.emergencyVisit.visitNo}</Link> : d.emergencyVisit.visitNo) : "—") },
          { key: "times", label: "On scene / closed", render: (d) => <span className="text-xs">{d.arrivedAt ? formatDateTime(d.arrivedAt, tz) : "—"}<span className="block text-muted">{d.completedAt ? formatDateTime(d.completedAt, tz) : "—"}</span></span> },
          { key: "status", label: "Status", render: (d) => <StatusBadge status={d.status === "DISPATCHED" ? "SCHEDULED" : d.status === "ON_SCENE" || d.status === "TRANSPORTING" ? "IN_PROGRESS" : d.status} label={erLabel(d.status)} /> },
          { key: "actions", label: "", align: "right", render: (d) => <DispatchActions dispatch={{ id: d.id, status: d.status }} canManage={canManage} /> },
        ]} />
      <Pagination path="/ambulances" params={params} meta={meta} />
    </>
  );
}
