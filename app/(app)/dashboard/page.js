import { LayoutDashboard } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { availableViews, defaultView, buildContext } from "@/lib/services/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/States";
import { buildHref } from "@/components/ui/DataTable";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { OverviewSection } from "@/components/dashboard/OverviewSection";
import { DoctorSection, ReceptionSection, NursingSection, LaboratorySection, RadiologySection, PharmacySection, BillingSection } from "@/components/dashboard/RoleSections";

export const metadata = { title: "Dashboard" };

const SECTIONS = {
  overview: OverviewSection, doctor: DoctorSection, reception: ReceptionSection, nursing: NursingSection,
  laboratory: LaboratorySection, radiology: RadiologySection, pharmacy: PharmacySection, billing: BillingSection,
};

function greeting(tz) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({ searchParams }) {
  const session = await requirePageSession("dashboard:read");
  const sp = await searchParams;
  const hospital = await getHospital();
  const ctx = buildContext(hospital, { range: sp.range, from: sp.from, to: sp.to });
  const views = availableViews(session);
  const view = views.some((v) => v.key === sp.view) ? sp.view : defaultView(session, views);
  const Section = view ? SECTIONS[view] : null;
  const base = buildHref("/dashboard", { range: ctx.period.key, ...(ctx.period.key === "custom" ? { from: ctx.period.from, to: ctx.period.to } : {}) });
  const first = session.user.name.split(" ")[0];

  return (
    <>
      <PageHeader title={`${greeting(ctx.tz)}, ${first}`} description={`${hospital.name} · figures use the ${ctx.tz} time zone. Period metrics cover ${ctx.period.label.toLowerCase()}.`}
        actions={<PeriodFilter key={`${ctx.period.key}-${ctx.period.from}-${ctx.period.to}`} period={ctx.period} />} />
      {views.length > 1 && (
        <div className="card mb-5 overflow-hidden">
          <LinkTabs tabs={views} active={view} baseHref={base} param="view" />
        </div>
      )}
      {Section ? <Section session={session} ctx={ctx} /> : (
        <div className="card">
          <EmptyState icon={LayoutDashboard} title="No dashboard widgets for your role" description="Use the navigation to open the modules you have access to. Your notifications are available from the bell icon." />
        </div>
      )}
    </>
  );
}
