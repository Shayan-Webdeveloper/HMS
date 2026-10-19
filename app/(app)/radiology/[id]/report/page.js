import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileLock2 } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getImagingStudy } from "@/lib/services/radiology";
import { getHospital } from "@/lib/services/settings";
import { modalityLabel } from "@/lib/validation/radiology";
import { ageFromDob, formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { PrintButton } from "@/components/laboratory/PrintButton";

export const metadata = { title: "Imaging report" };

const sexLabel = (s) => (s && s !== "UNKNOWN" ? s.charAt(0) + s.slice(1).toLowerCase() : "Not recorded");

export default async function ImagingReportPage({ params }) {
  const session = await requirePageSession("radiology:read");
  const { id } = await params;
  const s = await getImagingStudy(id);
  if (!s) notFound();
  if (s.status !== "VERIFIED" || !s.report) {
    return (
      <div className="card max-w-xl mx-auto">
        <EmptyState icon={FileLock2} title="Report not available" description="A printable report is only available once the report has been verified."
          action={<Button href={`/radiology/${s.id}`}>Back to study</Button>} />
      </div>
    );
  }
  const h = await getHospital();
  const tz = h.timezone;
  await audit({ userId: session.user.id, action: "imaging.report.view", entityType: "ImagingStudy", entityId: s.id });
  const profile = h.settings?.["hospital.profile"] || {};
  const hospitalName = profile.name || h.name;
  const age = ageFromDob(s.patient.dateOfBirth);
  const nameOf = (uid) => (uid ? s.userNames[uid] || "Unknown user" : "—");

  return (
    <div className="max-w-[860px] mx-auto">
      <div className="no-print flex items-center justify-between gap-3 mb-4">
        <Link href={`/radiology/${s.id}`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ChevronLeft size={15} aria-hidden /> Back to study</Link>
        <PrintButton label="Print report" />
      </div>
      <article className="card print-doc p-6 sm:p-10 text-[13px] leading-relaxed">
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b-2 border-ink">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-lg bg-primary text-white font-bold flex items-center justify-center text-[15px] shrink-0" aria-hidden>{profile.logoText || hospitalName.slice(0, 3).toUpperCase()}</div>
            <div>
              <p className="text-[18px] font-bold tracking-tight">{hospitalName}</p>
              {(profile.address || h.address) && <p className="text-muted">{profile.address || h.address}</p>}
              <p className="text-muted">{[profile.phone || h.phone, profile.email || h.email].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-[15px] font-bold uppercase tracking-wider">Radiology report</p>
            <p className="font-mono font-semibold">{s.studyNo}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-success">Verified</p>
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 py-5 border-b border-border">
          <Field label="Patient" value={`${s.patient.firstName} ${s.patient.lastName}`} strong />
          <Field label="MRN" value={s.patient.mrn} mono />
          <Field label="Age / Sex" value={`${age != null ? `${age} years` : "Age unknown"} / ${sexLabel(s.patient.sex)}`} />
          <Field label="Date of birth" value={s.patient.dateOfBirth ? formatDateOnly(s.patient.dateOfBirth) : "Not recorded"} />
          <Field label="Examination" value={`${modalityLabel(s.modality)}: ${s.bodyPart}`} />
          <Field label="Requested by" value={nameOf(s.requestedById)} />
          <Field label="Requested" value={formatDateTime(s.createdAt, tz)} />
          {s.scheduledAt && <Field label="Scheduled" value={formatDateTime(s.scheduledAt, tz)} />}
        </section>

        {s.indication && (
          <section className="py-4 border-b border-border">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Clinical indication</p>
            <p className="whitespace-pre-wrap">{s.indication}</p>
          </section>
        )}
        <section className="py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Findings</p>
          <p className="whitespace-pre-wrap">{s.report.findings}</p>
        </section>
        <section className="py-4 border-b border-border">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Impression</p>
          <p className="whitespace-pre-wrap font-semibold">{s.report.impression}</p>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 pt-4">
          <Field label="Reported by" value={`${nameOf(s.report.reportedById)}, ${formatDateTime(s.report.reportedAt, tz)}`} />
          <Field label="Verified by" value={`${nameOf(s.report.verifiedById)}, ${formatDateTime(s.report.verifiedAt, tz)}`} />
          {s.attachments.length > 0 && <Field label="Attachments" value={`${s.attachments.length} file(s) on record`} />}
          <Field label="Report generated" value={formatDateTime(new Date(), tz)} />
        </section>

        <footer className="mt-6 pt-4 border-t border-border text-[11.5px] text-muted space-y-1">
          <p className="font-semibold text-ink">This report must be interpreted by a qualified clinician in the context of the patient's clinical condition.</p>
          <p>Generated electronically; valid without a signature. Times shown in {tz}.</p>
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
