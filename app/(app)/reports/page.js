import Link from "next/link";
import { BarChart3, Lock, ChevronRight } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { REPORTS, REPORT_CATEGORIES, canViewReport } from "@/lib/services/reports";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";

export const metadata = { title: "Reports & Analytics" };

export default async function ReportsIndexPage() {
  const session = await requirePageSession("reports:read");
  const visible = REPORTS.filter((r) => canViewReport(session, r));
  const hidden = REPORTS.length - visible.length;
  const exportable = can(session, "reports:export");

  return (
    <>
      <PageHeader title="Reports & Analytics" description={`Operational${can(session, "reports:financial") ? " and financial" : ""} reports from live data. All dates use the hospital time zone.${exportable ? " Every report can be exported to CSV." : ""}`} />
      {visible.length === 0 ? <div className="card"><EmptyState icon={BarChart3} title="No reports available" description="Your role does not include any reports." /></div> : (
        <div className="space-y-6">
          {REPORT_CATEGORIES.map((cat) => {
            const list = visible.filter((r) => r.category === cat);
            if (!list.length) return null;
            return (
              <section key={cat} aria-labelledby={`cat-${cat}`}>
                <h2 id={`cat-${cat}`} className="text-[12px] font-semibold uppercase tracking-wider text-muted mb-2">{cat}</h2>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {list.map((r) => (
                    <Link key={r.key} href={`/reports/${r.key}`} className="card p-4 group hover:shadow-[var(--shadow-md)] hover:border-primary/40 transition-shadow flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-[14px] group-hover:text-primary flex items-center gap-2 flex-wrap">{r.title}{r.requires.includes("reports:financial") && <Badge tone="teal" plain>Financial</Badge>}</p>
                        <p className="text-[13px] text-muted mt-1">{r.description}</p>
                      </div>
                      <ChevronRight size={16} className="text-subtle group-hover:text-primary shrink-0 mt-1" aria-hidden />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
          {hidden > 0 && <p className="text-xs text-subtle flex items-center gap-1.5"><Lock size={12} aria-hidden /> {hidden} further report{hidden === 1 ? " requires" : "s require"} additional permissions (financial or HR).</p>}
        </div>
      )}
    </>
  );
}
