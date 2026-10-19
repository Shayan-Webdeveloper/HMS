import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileLock2 } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getLabOrder } from "@/lib/services/lab";
import { getHospital } from "@/lib/services/settings";
import { describeReference } from "@/lib/validation/lab";
import { ageFromDob, formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { PrintButton } from "@/components/laboratory/PrintButton";

export const metadata = { title: "Lab report" };

const sexLabel = (s) => (s && s !== "UNKNOWN" ? s.charAt(0) + s.slice(1).toLowerCase() : "Not recorded");

export default async function LabReportPage({ params }) {
  const session = await requirePageSession("lab:read");
  const { id } = await params;
  const order = await getLabOrder(id);
  if (!order) notFound();
  const h = await getHospital();
  const tz = h.timezone;

  if (order.status !== "RELEASED") {
    return (
      <div className="card max-w-xl mx-auto">
        <EmptyState icon={FileLock2} title="Report not available" description="A printable report is only available once results have been validated and released."
          action={<Button href={`/laboratory/${order.id}`}>Back to order</Button>} />
      </div>
    );
  }
  await audit({ userId: session.user.id, action: "lab.report.view", entityType: "LabOrder", entityId: order.id });

  const profile = h.settings?.["hospital.profile"] || {};
  const names = order.userNames;
  const rows = order.items.map((it) => {
    const r = it.results.find((x) => x.isCurrent);
    const amended = it.results.some((x) => !x.isCurrent && x.validatedAt);
    return { it, r, amended };
  });
  const performedBy = [...new Set(rows.map((x) => x.r?.enteredById).filter(Boolean))].map((u) => names[u] || "Unknown user");
  const validatedBy = [...new Set(rows.map((x) => x.r?.validatedById).filter(Boolean))].map((u) => names[u] || "Unknown user");
  const anyAmended = rows.some((x) => x.amended);
  const specimens = order.specimens.filter((s) => s.status === "COLLECTED");
  const age = ageFromDob(order.patient.dateOfBirth);
  const hospitalName = profile.name || h.name;

  return (
    <div className="max-w-[860px] mx-auto">
      <div className="no-print flex items-center justify-between gap-3 mb-4">
        <Link href={`/laboratory/${order.id}`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ChevronLeft size={15} aria-hidden /> Back to order</Link>
        <PrintButton label="Print report" />
      </div>

      <article className="card print-doc p-6 sm:p-10 text-[13px] leading-relaxed">
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b-2 border-ink">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-lg bg-primary text-white font-bold flex items-center justify-center text-[15px] shrink-0" aria-hidden>{profile.logoText || hospitalName.slice(0, 3).toUpperCase()}</div>
            <div>
              <p className="text-[18px] font-bold tracking-tight">{hospitalName}</p>
              {(h.address || profile.address) && <p className="text-muted">{profile.address || h.address}</p>}
              <p className="text-muted">{[profile.phone || h.phone, profile.email || h.email].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-[15px] font-bold uppercase tracking-wider">Laboratory report</p>
            <p className="font-mono font-semibold">{order.orderNo}</p>
            <p className={`text-xs font-semibold uppercase tracking-wide ${anyAmended ? "text-warning" : "text-success"}`}>{anyAmended ? "Final: amended" : "Final"}</p>
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 py-5 border-b border-border">
          <Field label="Patient" value={`${order.patient.firstName} ${order.patient.lastName}`} strong />
          <Field label="MRN" value={order.patient.mrn} mono />
          <Field label="Age / Sex" value={`${age != null ? `${age} years` : "Age unknown"} / ${sexLabel(order.patient.sex)}`} />
          <Field label="Date of birth" value={order.patient.dateOfBirth ? formatDateOnly(order.patient.dateOfBirth) : "Not recorded"} />
          <Field label="Ordering doctor" value={`Dr. ${order.doctor.staff.firstName} ${order.doctor.staff.lastName}${order.doctor.department?.name ? ` (${order.doctor.department.name})` : ""}`} />
          <Field label="Ordered" value={formatDateTime(order.createdAt, tz)} />
          <Field label="Priority" value={order.priority} />
          {order.encounter && <Field label="Encounter" value={order.encounter.encounterNo} mono />}
        </section>

        <section className="py-4 border-b border-border">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Specimen{specimens.length === 1 ? "" : "s"}</p>
          {specimens.length === 0 ? <p className="text-muted">No specimen record.</p> : (
            <ul className="space-y-0.5">
              {specimens.map((s) => (
                <li key={s.id}><span className="font-mono font-semibold">{s.specimenNo}</span> · {s.type} · collected {formatDateTime(s.collectedAt, tz)}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="py-5">
          <table className="w-full text-[13px] border-collapse">
            <caption className="sr-only">Laboratory results</caption>
            <thead>
              <tr className="border-b border-ink text-left">
                <th className="py-2 pr-3 font-semibold">Test</th>
                <th className="py-2 pr-3 font-semibold text-right">Result</th>
                <th className="py-2 pr-3 font-semibold">Unit</th>
                <th className="py-2 pr-3 font-semibold">Reference range</th>
                <th className="py-2 font-semibold">Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ it, r, amended }) => {
                const abnormal = r?.flag === "HIGH" || r?.flag === "LOW";
                return (
                  <tr key={it.id} className="border-b border-border align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{it.test.name}</span>{amended && <sup className="text-warning font-bold"> †</sup>}
                      {r?.comment && <span className="block text-xs text-muted">Comment: {r.comment}</span>}
                    </td>
                    <td className={`py-2 pr-3 text-right tabular ${abnormal ? "font-bold" : "font-semibold"}`}>{r ? r.value : "—"}</td>
                    <td className="py-2 pr-3">{r?.unit || ""}</td>
                    <td className="py-2 pr-3 text-muted">{r?.referenceRange || describeReference(it.test) || "—"}</td>
                    <td className={`py-2 font-semibold ${abnormal ? "text-danger" : ""}`}>{r?.flag ? (r.flag === "NORMAL" ? "" : r.flag) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11.5px] text-muted mt-2">Flags (LOW/HIGH) indicate only that a numeric value lies outside the laboratory's configured reference range.</p>
          {anyAmended && <p className="text-[11.5px] text-warning mt-1">† Result corrected after initial release; the corrected value was re-validated.</p>}
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 pt-4 border-t border-border">
          <Field label="Performed by" value={performedBy.join(", ") || "—"} />
          <Field label="Validated by" value={validatedBy.join(", ") || "—"} />
          <Field label="Released" value={`${formatDateTime(order.releasedAt, tz)}${order.releasedById ? ` by ${names[order.releasedById] || "Unknown user"}` : ""}`} />
          <Field label="Report generated" value={formatDateTime(new Date(), tz)} />
        </section>

        <footer className="mt-6 pt-4 border-t border-border text-[11.5px] text-muted space-y-1">
          <p className="font-semibold text-ink">Results must be interpreted by a qualified clinician in the context of the patient's clinical condition.</p>
          <p>This report was generated electronically and is valid without a signature. Times shown in {tz}.</p>
          <p className="text-center pt-2 tracking-widest uppercase text-subtle">End of report</p>
        </footer>
      </article>
    </div>
  );
}

function Field({ label, value, strong, mono }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted w-[120px] shrink-0">{label}</span>
      <span className={`${strong ? "font-bold" : "font-medium"} ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
