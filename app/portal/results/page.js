import { FlaskConical, ScanLine, Info } from "lucide-react";
import { requirePortalSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { portalResults } from "@/lib/services/dashboard";
import { formatDateTime, formatDate } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";

export const metadata = { title: "Results" };

export default async function PortalResultsPage() {
  const session = await requirePortalSession();
  const h = await getHospital();
  const tz = h.timezone;
  const { labs, imaging } = await portalResults(session.patientId);
  return (
    <>
      <PageHeader title="My results" description="Laboratory results appear once validated and released; imaging reports once verified by a radiologist." />
      <div role="note" className="mb-5 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-[13px] text-info flex gap-2">
        <Info size={16} className="shrink-0 mt-0.5" aria-hidden />
        <p>Flags show only whether a value is outside the laboratory's reference range — they are not a diagnosis. Please discuss your results with your doctor.</p>
      </div>
      <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-2"><FlaskConical size={16} aria-hidden /> Laboratory</h2>
      {labs.length === 0 ? <div className="card mb-6"><EmptyState icon={FlaskConical} title="No released lab results" /></div> : (
        <div className="space-y-4 mb-6">
          {labs.map((o) => (
            <section key={o.id} className="card" aria-labelledby={`lab-${o.id}`}>
              <header className="card-header flex-wrap">
                <div>
                  <h3 id={`lab-${o.id}`} className="card-title">{o.orderNo}</h3>
                  <p className="text-xs text-muted">Ordered {formatDate(o.createdAt, tz)} by Dr. {o.doctor.staff.firstName} {o.doctor.staff.lastName} · released {formatDateTime(o.releasedAt, tz)}</p>
                </div>
              </header>
              <div className="table-wrap">
                <table className="table table-responsive">
                  <thead><tr><th>Test</th><th className="num">Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead>
                  <tbody>
                    {o.items.map((it) => {
                      const r = it.results[0];
                      return (
                        <tr key={it.id}>
                          <td data-label="Test" className="font-medium">{it.test.name}{r?.comment && <span className="block text-xs text-muted font-normal">{r.comment}</span>}</td>
                          <td data-label="Result" className="num font-semibold">{r ? r.value : <span className="text-subtle font-normal">Not reported</span>}</td>
                          <td data-label="Unit">{r?.unit || it.test.unit || "—"}</td>
                          <td data-label="Reference range" className="text-muted">{r?.referenceRange || "—"}</td>
                          <td data-label="Flag">{r?.flag ? <StatusBadge status={r.flag} /> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
      <h2 className="text-[15px] font-semibold mb-3 flex items-center gap-2"><ScanLine size={16} aria-hidden /> Imaging</h2>
      {imaging.length === 0 ? <div className="card"><EmptyState icon={ScanLine} title="No verified imaging reports" /></div> : (
        <div className="space-y-4">
          {imaging.map((s) => (
            <section key={s.id} className="card" aria-labelledby={`img-${s.id}`}>
              <header className="card-header flex-wrap">
                <div>
                  <h3 id={`img-${s.id}`} className="card-title">{s.modality} — {s.bodyPart}</h3>
                  <p className="text-xs text-muted">{s.studyNo} · verified {formatDateTime(s.report.verifiedAt, tz)}</p>
                </div>
              </header>
              <div className="card-body space-y-3 text-[13.5px]">
                <div><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Findings</p><p className="whitespace-pre-line">{s.report.findings}</p></div>
                <div><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Impression</p><p className="whitespace-pre-line font-medium">{s.report.impression}</p></div>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
