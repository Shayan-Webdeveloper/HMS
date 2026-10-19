import { Plus, BedDouble, CheckCircle2, User, Sparkles, Wrench, Gauge } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { getBedBoard } from "@/lib/services/wards";
import { getHospital } from "@/lib/services/settings";
import { WARD_TYPES, formatLos } from "@/lib/validation/inpatient";
import { formatMoney } from "@/lib/utils/money";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { FilterBar } from "@/components/ui/FilterBar";
import { BedBoard, BedLegend } from "@/components/inpatient/BedBoard";

export const metadata = { title: "Wards & beds" };

export default async function WardsPage({ searchParams }) {
  const session = await requirePageSession("wards:read");
  const sp = await searchParams;
  const type = WARD_TYPES.includes(sp.type) ? sp.type : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const canManage = can(session, "wards:manage");
  const h = await getHospital();
  const { wards, overall } = await getBedBoard({ type, q, includeInactive: canManage });
  const data = serialize(wards.map((w) => ({
    ...w,
    dailyRateLabel: formatMoney(w.dailyRate, h.currency, h.locale),
    beds: w.beds.map((b) => ({ ...b, losLabel: b.admission ? formatLos(b.admission.admittedAt, null, h.timezone) : null })),
  })));

  return (
    <>
      <PageHeader title="Wards & beds" description="Live bed board. Select a bed to see the occupant or change its status."
        actions={<>
          {can(session, "admissions:read") && <Button href="/admissions">Admissions</Button>}
          {canManage && <Button variant="primary" icon={Plus} href="/wards/new">New ward</Button>}
        </>} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <MetricCard label="Beds in service" value={overall.inService} icon={BedDouble} tone="primary" hint={`${overall.total} total`} />
        <MetricCard label="Occupied" value={overall.OCCUPIED} icon={User} tone="primary" />
        <MetricCard label="Available" value={overall.AVAILABLE} icon={CheckCircle2} tone="success" />
        <MetricCard label="Cleaning" value={overall.CLEANING} icon={Sparkles} tone="warning" hint={overall.RESERVED ? `${overall.RESERVED} reserved` : undefined} />
        <MetricCard label="Out of service" value={overall.OUT_OF_SERVICE} icon={Wrench} tone="danger" />
        <MetricCard label="Occupancy" value={`${overall.occupancyPct}%`} icon={Gauge} tone={overall.occupancyPct >= 90 ? "danger" : overall.occupancyPct >= 75 ? "warning" : "teal"} hint="of beds in service" />
      </div>

      <div className="card mb-5">
        <FilterBar placeholder="Search bed, ward, patient or MRN…"
          filters={[{ name: "type", label: "Ward type", options: WARD_TYPES.map((t) => ({ value: t, label: t[0] + t.slice(1).toLowerCase() })) }]} />
        <div className="px-4 py-3"><BedLegend counts={overall} /></div>
      </div>

      <BedBoard wards={data} canManage={canManage} canAdmit={can(session, "admissions:create")} canViewAdmissions={can(session, "admissions:read")} />
    </>
  );
}
