import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Phone, Printer, ShieldAlert } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getPrescriptionForDispensing, pharmacyContext } from "@/lib/services/pharmacy";
import { DISPENSABLE_STATUSES, RETURNABLE_STATUSES } from "@/lib/validation/pharmacy";
import { ageFromDob, formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { DispensePanel } from "@/components/pharmacy/DispensePanel";
import { MovementBadge, SignedQty } from "@/components/pharmacy/LedgerTable";

export const metadata = { title: "Dispense prescription" };

const SEVERITY_TONE = { SEVERE: "bg-danger text-white", MODERATE: "bg-white/70 text-danger", MILD: "bg-white/70 text-danger", UNKNOWN: "bg-white/70 text-danger" };

export default async function PrescriptionDispensePage({ params }) {
  const session = await requirePageSession("prescriptions:read");
  const { id } = await params;
  const ctx = await pharmacyContext();
  const rx = await getPrescriptionForDispensing(id, ctx);
  if (!rx) notFound();
  await audit({ userId: session.user.id, action: "prescription.view", entityType: "Prescription", entityId: rx.id });

  const p = rx.patient;
  const age = ageFromDob(p.dateOfBirth);
  const dispensable = DISPENSABLE_STATUSES.includes(rx.status);
  const returnable = RETURNABLE_STATUSES.includes(rx.status);
  const canDispense = can(session, "pharmacy:dispense");
  const prescriber = `Dr. ${rx.doctor.staff.firstName} ${rx.doctor.staff.lastName}`;
  const shortages = rx.items.filter((i) => i.remaining > 0 && i.onHand < i.remaining);

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <Link href="/pharmacy?tab=prescriptions" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden /> Dispensing queue</Link>
        <Button icon={Printer} href={`/pharmacy/prescriptions/${rx.id}/slip`}>Dispensing slip</Button>
      </div>

      {/* Patient banner */}
      <section className="card p-5 mb-5" aria-label="Patient">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex gap-4 min-w-0">
            <div className="w-12 h-12 rounded-full bg-primary-soft text-primary-ink font-bold flex items-center justify-center shrink-0" aria-hidden>{p.firstName[0]}{p.lastName[0]}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[20px] font-bold tracking-tight">{p.firstName} {p.lastName}</h1>
                {p.status !== "ACTIVE" && <StatusBadge status={p.status} />}
              </div>
              <p className="text-[13px] text-muted mt-0.5">
                <span className="font-mono font-semibold text-ink">{p.mrn}</span> · {age != null ? `${age} y` : "Age unknown"} · {p.sex === "UNKNOWN" ? "Sex not recorded" : p.sex.toLowerCase()}
                {p.dateOfBirth && <> · DOB {formatDateOnly(p.dateOfBirth)}</>}
                {p.phone && <span className="inline-flex items-center gap-1 ml-2"><Phone size={12} aria-hidden />{p.phone}</span>}
              </p>
            </div>
          </div>
          <div className="lg:text-right">
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <span className="font-mono text-[15px] font-bold">{rx.prescriptionNo}</span>
              <StatusBadge status={rx.status} />
            </div>
            <p className="text-[13px] text-muted mt-0.5">{prescriber} · {rx.doctor.specialty}{rx.doctor.department?.name ? ` · ${rx.doctor.department.name}` : ""}</p>
            <p className="text-[12.5px] text-subtle">Issued {formatDateTime(rx.issuedAt ?? rx.createdAt, ctx.tz)}
              {rx.encounter && (can(session, "clinical:read")
                ? <> · <Link className="text-primary hover:underline" href={`/consultations/${rx.encounter.id}`}>{rx.encounter.encounterNo}</Link></>
                : <> · {rx.encounter.encounterNo}</>)}
            </p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-2">Allergies</p>
          {p.allergies.length === 0 ? <p className="text-[13px] text-muted">No known allergies recorded</p> : (
            <ul className="flex flex-wrap gap-2" aria-label="Active allergies">
              {p.allergies.map((a) => (
                <li key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft text-danger text-[12.5px] font-semibold pl-2.5 pr-1 h-7">
                  <ShieldAlert size={13} aria-hidden />{a.substance}{a.reaction ? ` — ${a.reaction}` : ""}
                  <span className={`rounded-full px-1.5 h-5 inline-flex items-center text-[11px] ${SEVERITY_TONE[a.severity] || SEVERITY_TONE.UNKNOWN}`}>{a.severity.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {p.medicalAlerts && (
          <div className="mt-3 rounded-lg bg-warning-soft border border-warning/30 px-3 py-2 text-[13px] text-warning font-medium flex items-start gap-2" role="note">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {p.medicalAlerts}
          </div>
        )}
      </section>

      {rx.status === "DRAFT" && <Notice tone="neutral">This prescription is still a draft with the prescriber. It cannot be dispensed until it is issued.</Notice>}
      {rx.status === "CANCELLED" && <Notice tone="neutral">This prescription was cancelled{rx.cancelReason ? ` — ${rx.cancelReason}` : ""}. It cannot be dispensed.</Notice>}
      {rx.status === "DISPENSED" && <Notice tone="success">All items have been dispensed. Returns can be recorded per item if stock comes back.</Notice>}
      {dispensable && canDispense && shortages.length > 0 && (
        <Notice tone="warning">Insufficient usable stock for {shortages.map((s) => `${s.medication.genericName} ${s.medication.strength}`).join(", ")}. You can dispense what is available now and the rest later (partial dispensing).</Notice>
      )}

      <Card title="Items" description={dispensable && canDispense ? "Quantities default to what remains, capped by usable stock." : undefined} noPadding className="mb-5">
        <DispensePanel key={`${rx.status}:${rx.items.map((i) => `${i.dispensedQty}/${i.onHand}`).join(",")}`} prescriptionId={rx.id} prescriptionNo={rx.prescriptionNo} items={serialize(rx.items)} dispensable={dispensable} canDispense={canDispense}
          canReturn={canDispense} returnable={returnable} />
        {rx.notes && <div className="px-4 py-3 border-t border-border text-[13px]"><span className="font-semibold">Prescriber notes: </span><span className="text-muted">{rx.notes}</span></div>}
      </Card>

      <Card title="Dispensing history" description="Batch-level ledger entries for this prescription." noPadding>
        <DataTable rows={rx.history} caption="Dispensing history"
          empty={<EmptyState title="Nothing dispensed yet" description="Each dispense or return is listed here with the batch used." />}
          columns={[
            { key: "at", label: "When", render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt, ctx.tz)}</span> },
            { key: "item", label: "Medicine", render: (r) => (r.item ? `${r.item.medication.genericName} ${r.item.medication.strength}` : "—") },
            { key: "type", label: "Type", render: (r) => <MovementBadge type={r.type} /> },
            { key: "batch", label: "Batch", render: (r) => (r.batch ? <span><span className="font-mono text-[12.5px]">{r.batch.batchNo}</span> <span className="text-xs text-subtle">exp. {formatDateOnly(r.batch.expiryDate)}</span></span> : "—") },
            { key: "qty", label: "Qty", align: "right", render: (r) => <SignedQty value={r.quantity} /> },
            { key: "reason", label: "Note", render: (r) => <span className="text-[13px] text-muted">{r.type === "RETURN" ? r.reason : "—"}</span> },
            { key: "by", label: "By", render: (r) => r.performedByName },
          ]} />
      </Card>
    </>
  );
}

function Notice({ tone, children }) {
  const cls = { warning: "bg-warning-soft border-warning/30 text-warning", success: "bg-success-soft border-success/30 text-success", neutral: "bg-neutral-soft border-border text-muted" }[tone];
  return <div role="status" className={`rounded-lg border px-4 py-2.5 text-[13px] font-medium mb-4 ${cls}`}>{children}</div>;
}
