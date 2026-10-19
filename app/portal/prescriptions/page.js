import { Pill } from "lucide-react";
import { requirePortalSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { portalPrescriptions } from "@/lib/services/dashboard";
import { formatDate } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";

export const metadata = { title: "Prescriptions" };

export default async function PortalPrescriptionsPage() {
  const session = await requirePortalSession();
  const h = await getHospital();
  const rows = await portalPrescriptions(session.patientId);
  return (
    <>
      <PageHeader title="My prescriptions" description="Medicines prescribed to you. Always follow your doctor's and pharmacist's instructions; do not change doses without advice." />
      {rows.length === 0 ? <div className="card"><EmptyState icon={Pill} title="No prescriptions" description="Prescriptions issued by your doctor will appear here." /></div> : (
        <div className="space-y-4">
          {rows.map((p) => (
            <section key={p.id} className="card" aria-labelledby={`rx-${p.id}`}>
              <header className="card-header flex-wrap">
                <div>
                  <h2 id={`rx-${p.id}`} className="card-title">{p.prescriptionNo}</h2>
                  <p className="text-xs text-muted">Issued {formatDate(p.issuedAt || p.createdAt, h.timezone)} by Dr. {p.doctor.staff.firstName} {p.doctor.staff.lastName}</p>
                </div>
                <StatusBadge status={p.status} />
              </header>
              <div className="table-wrap">
                <table className="table table-responsive">
                  <thead><tr><th>Medicine</th><th>Dose</th><th>How often</th><th className="num">Days</th><th className="num">Quantity</th><th className="num">Dispensed</th><th>Instructions</th></tr></thead>
                  <tbody>
                    {p.items.map((i) => (
                      <tr key={i.id}>
                        <td data-label="Medicine"><span className="font-medium">{i.medication.genericName} {i.medication.strength}</span>{i.medication.brandName && <span className="block text-xs text-muted">{i.medication.brandName} · {i.medication.dosageForm.toLowerCase()}</span>}</td>
                        <td data-label="Dose">{i.dose} <span className="text-muted">({i.route})</span></td>
                        <td data-label="How often">{i.frequency}</td>
                        <td data-label="Days" className="num">{i.durationDays}</td>
                        <td data-label="Quantity" className="num">{i.quantity}</td>
                        <td data-label="Dispensed" className="num">{i.dispensedQty}</td>
                        <td data-label="Instructions">{i.instructions || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {p.status === "CANCELLED" && <p className="px-4 py-2.5 border-t border-border text-xs text-danger">This prescription was cancelled. Do not use it.</p>}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
