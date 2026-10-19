import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getHospital } from "@/lib/services/settings";
import { getPrescriptionForDispensing, pharmacyContext } from "@/lib/services/pharmacy";
import { netDispensedByBatch, humanize } from "@/lib/validation/pharmacy";
import { ageFromDob, formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { PrintButton } from "@/components/inventory/common";

export const metadata = { title: "Dispensing slip" };

export default async function DispensingSlipPage({ params }) {
  const session = await requirePageSession("prescriptions:read");
  const { id } = await params;
  const ctx = await pharmacyContext();
  const [rx, h] = await Promise.all([getPrescriptionForDispensing(id, ctx), getHospital()]);
  if (!rx) notFound();
  await audit({ userId: session.user.id, action: "prescription.slip", entityType: "Prescription", entityId: rx.id });
  const p = rx.patient;
  const age = ageFromDob(p.dateOfBirth);
  const lastDispense = [...rx.history].reverse().find((m) => m.type === "DISPENSE");
  const profile = h.settings?.["hospital.profile"] || {};

  return (
    <div className="max-w-3xl mx-auto">
      <div className="no-print flex items-center justify-between gap-2 mb-4">
        <Button icon={ArrowLeft} href={`/pharmacy/prescriptions/${rx.id}`}>Back</Button>
        <PrintButton label="Print slip" />
      </div>
      <article className="card print-doc p-6 sm:p-8">
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-border">
          <div>
            <p className="text-[18px] font-bold">{h.name}</p>
            {(h.address || profile.address) && <p className="text-[12.5px] text-muted">{h.address || profile.address}</p>}
            {(h.phone || profile.phone) && <p className="text-[12.5px] text-muted">Tel. {h.phone || profile.phone}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Dispensing slip</p>
            <p className="font-mono text-[16px] font-bold">{rx.prescriptionNo}</p>
            <p className="text-[12px] text-muted">Printed {formatDateTime(new Date(), ctx.tz)}</p>
          </div>
        </header>

        <section className="grid sm:grid-cols-2 gap-4 py-4 border-b border-border text-[13px]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Patient</p>
            <p className="font-semibold text-[14px]">{p.firstName} {p.lastName}</p>
            <p className="text-muted"><span className="font-mono">{p.mrn}</span> · {age != null ? `${age} y` : "Age unknown"} · {p.sex === "UNKNOWN" ? "—" : humanize(p.sex)}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Prescriber</p>
            <p className="font-semibold text-[14px]">Dr. {rx.doctor.staff.firstName} {rx.doctor.staff.lastName}</p>
            <p className="text-muted">Issued {formatDateTime(rx.issuedAt ?? rx.createdAt, ctx.tz)} · <StatusBadge status={rx.status} /></p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Allergies</p>
            <p className={p.allergies.length ? "font-semibold text-danger" : "text-muted"}>{p.allergies.length ? p.allergies.map((a) => `${a.substance} (${a.severity.toLowerCase()})`).join(", ") : "No known allergies recorded"}</p>
          </div>
        </section>

        <div className="table-wrap mt-2"><table className="table">
          <thead>
            <tr><th>Medicine</th><th>Directions</th><th className="num">Qty dispensed</th><th>Batch / expiry</th></tr>
          </thead>
          <tbody>
            {rx.items.map((it) => {
              const ledgerForItem = rx.history.filter((m) => m.referenceId === it.id);
              const net = netDispensedByBatch(ledgerForItem);
              const info = new Map(ledgerForItem.filter((m) => m.batch).map((m) => [m.batchId, m.batch]));
              const batches = [...net.entries()].filter(([, n]) => n > 0).map(([bid, n]) => ({ ...info.get(bid), n }));
              return (
                <tr key={it.id}>
                  <td>
                    <p className="font-semibold">{it.medication.genericName} {it.medication.strength}</p>
                    <p className="text-xs text-muted">{[it.medication.brandName, humanize(it.medication.dosageForm)].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="text-[13px]">
                    {it.dose} · {it.route} · {it.frequency} · {it.durationDays} day{it.durationDays === 1 ? "" : "s"}
                    {it.instructions && <p className="text-xs text-muted">{it.instructions}</p>}
                  </td>
                  <td className="num font-semibold">{it.dispensedQty} <span className="text-xs text-subtle font-normal">of {it.quantity} {it.medication.unit}</span></td>
                  <td className="text-[12.5px]">
                    {batches.length ? batches.map((b) => <p key={b.id}><span className="font-mono">{b.batchNo}</span> · exp. {formatDateOnly(b.expiryDate)} ({b.n})</p>) : <span className="text-subtle">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>

        {rx.items.some((i) => i.remaining > 0) && (
          <p className="mt-3 text-[12.5px] text-warning font-medium">Balance outstanding: {rx.items.filter((i) => i.remaining > 0).map((i) => `${i.medication.genericName} ${i.medication.strength} × ${i.remaining}`).join("; ")}.</p>
        )}

        <footer className="grid sm:grid-cols-2 gap-6 mt-8 pt-4 border-t border-border text-[12.5px]">
          <div>
            <p className="text-muted">Dispensed by</p>
            <p className="font-semibold">{lastDispense?.performedByName || "—"}{lastDispense && <span className="font-normal text-muted"> · {formatDateTime(lastDispense.createdAt, ctx.tz)}</span>}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-muted">Received by (patient / attendant)</p>
            <p className="mt-6 border-t border-border-strong pt-1 text-subtle">Signature</p>
          </div>
        </footer>
        <p className="mt-6 text-[11px] text-subtle">Printed by {session.user.name}. Keep medicines out of reach of children. Take exactly as directed by your doctor.</p>
      </article>
    </div>
  );
}
