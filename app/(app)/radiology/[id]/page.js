import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Paperclip, FileText, Info, FileImage, FileType2 } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getImagingStudy, getImagingActivity, redactImagingStudy } from "@/lib/services/radiology";
import { getHospital } from "@/lib/services/settings";
import { IMAGING_STATUS_LABELS, modalityLabel } from "@/lib/validation/radiology";
import { formatDateTime, todayInTz, toZonedDateString, toZonedTimeString } from "@/lib/utils/time";
import { formatMoney } from "@/lib/utils/money";
import { Card } from "@/components/ui/Card";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { PatientBanner } from "@/components/laboratory/PatientBanner";
import { StudyActions } from "@/components/radiology/StudyActions";
import { ReportForm } from "@/components/radiology/ReportForm";
import { AttachmentUploader } from "@/components/radiology/AttachmentUploader";

export const metadata = { title: "Imaging study" };

const ACTIVITY_LABELS = {
  "imaging.study.create": "Requested",
  "imaging.study.schedule": "Scheduled",
  "imaging.study.reschedule": "Rescheduled",
  "imaging.study.start": "Study started",
  "imaging.report.create": "Report entered",
  "imaging.report.update": "Report edited",
  "imaging.report.verify": "Report verified",
  "imaging.study.cancel": "Cancelled",
  "imaging.attachment.upload": "Attachment uploaded",
};

export default async function ImagingStudyPage({ params }) {
  const session = await requirePageSession("radiology:read");
  const { id } = await params;
  const raw = await getImagingStudy(id);
  if (!raw) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  await audit({ userId: session.user.id, action: "imaging.study.view", entityType: "ImagingStudy", entityId: raw.id });

  const isRadiology = can(session, ["radiology:report", "radiology:verify"]);
  const s = redactImagingStudy(raw, isRadiology);
  const perms = {
    report: can(session, "radiology:report"),
    verify: can(session, "radiology:verify"),
    cancel: isRadiology || (can(session, "radiology:order") && raw.requestedById === session.user.id),
  };
  const activity = isRadiology || can(session, "audit:read") ? await getImagingActivity(id) : [];
  const nameOf = (uid) => (uid ? raw.userNames[uid] || "Unknown user" : "—");

  const basis = defaultSlot(raw.scheduledAt);
  const studyForActions = {
    id: raw.id, studyNo: raw.studyNo, status: raw.status,
    defaultDate: toZonedDateString(basis, tz), defaultTime: toZonedTimeString(basis, tz), minDate: todayInTz(tz),
    selfVerify: raw.report?.reportedById === session.user.id,
  };
  const showForm = perms.report && (raw.status === "IN_PROGRESS" || raw.status === "REPORTED");
  const canUpload = isRadiology && raw.status !== "CANCELLED";

  return (
    <>
      <Link href="/radiology" className="no-print inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ChevronLeft size={15} aria-hidden /> Radiology worklist</Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold tracking-tight font-mono">{raw.studyNo}</h1>
            <StatusBadge status={raw.status} label={IMAGING_STATUS_LABELS[raw.status]} />
            <Badge tone="primary" plain>{modalityLabel(raw.modality)}</Badge>
          </div>
          <p className="text-[13px] text-muted mt-1">{raw.bodyPart} · requested {formatDateTime(raw.createdAt, tz)} by {nameOf(raw.requestedById)}</p>
        </div>
        <StudyActions study={studyForActions} perms={perms} tz={tz} />
      </div>

      <PatientBanner patient={raw.patient} href={can(session, "patients:read") ? `/patients/${raw.patient.id}` : undefined} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card title="Report"
            description={raw.status === "VERIFIED" ? `Verified ${formatDateTime(raw.report?.verifiedAt, tz)} by ${nameOf(raw.report?.verifiedById)}` : raw.status === "REPORTED" ? "Awaiting verification" : undefined}
            actions={raw.status === "VERIFIED" && <Link href={`/radiology/${raw.id}/report`} className="btn btn-secondary btn-sm"><FileText size={14} aria-hidden /> Printable report</Link>}>
            {showForm ? (
              <ReportForm studyId={raw.id} status={raw.status} report={raw.report ? { findings: raw.report.findings, impression: raw.report.impression } : null} />
            ) : s.report ? (
              <div className="space-y-4">
                <div><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-1">Findings</p><p className="text-[13.5px] whitespace-pre-wrap">{s.report.findings}</p></div>
                <div><p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-1">Impression</p><p className="text-[13.5px] whitespace-pre-wrap font-medium">{s.report.impression}</p></div>
                <p className="text-xs text-subtle">Reported by {nameOf(s.report.reportedById)} · {formatDateTime(s.report.reportedAt, tz)}</p>
              </div>
            ) : s.reportPendingVerification ? (
              <EmptyState icon={FileText} title="Report pending verification" description="The report will be visible here once a radiologist verifies it." />
            ) : raw.status === "CANCELLED" ? (
              <EmptyState title="Study cancelled" description={raw.cancellation?.reason ? `Reason: ${raw.cancellation.reason}` : undefined} />
            ) : (
              <EmptyState icon={FileText} title="No report yet" description={perms.report ? (raw.status === "IN_PROGRESS" ? "" : "Start the study to enter a report.") : "The report will appear here once verified."} />
            )}
          </Card>

          <Card title={<span className="inline-flex items-center gap-2"><Paperclip size={15} aria-hidden /> Attachments</span>} noPadding>
            <div className="px-4 py-3 border-b border-border bg-info-soft text-info text-[12.5px] flex items-start gap-2" role="note">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>Image attachments are not a PACS/DICOM viewer; production DICOM storage requires a separate PACS integration.</span>
            </div>
            {canUpload && <div className="p-4 border-b border-border"><AttachmentUploader studyId={raw.id} /></div>}
            {raw.attachments.length === 0 ? (
              <EmptyState icon={Paperclip} title="No attachments" description={canUpload ? "Upload key images (PNG/JPEG) or an external report (PDF)." : "Key images or external reports uploaded by radiology appear here."} />
            ) : (
              <ul className="divide-y divide-border">
                {raw.attachments.map((d) => {
                  const Icon = d.mimeType === "application/pdf" ? FileType2 : FileImage;
                  return (
                    <li key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon size={18} className="text-muted shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-[13.5px] font-medium text-primary hover:underline break-all">{d.originalName}</a>
                          <p className="text-xs text-subtle">{(d.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(d.createdAt, tz)}</p>
                        </div>
                      </div>
                      <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Open</a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title="Study details">
            <dl className="space-y-3 text-[13px]">
              <Row label="Examination">{raw.bodyPart}<span className="block text-xs text-muted">{modalityLabel(raw.modality)}</span></Row>
              <Row label="Requested by">{nameOf(raw.requestedById)}<span className="block text-xs text-muted">{formatDateTime(raw.createdAt, tz)}</span></Row>
              <Row label="Scheduled">{raw.scheduledAt ? formatDateTime(raw.scheduledAt, tz) : <span className="text-muted">Not scheduled</span>}</Row>
              {raw.encounter && <Row label="Encounter">{can(session, "clinical:read") ? <Link href={`/consultations/${raw.encounter.id}`} className="font-mono text-primary hover:underline">{raw.encounter.encounterNo}</Link> : <span className="font-mono">{raw.encounter.encounterNo}</span>}</Row>}
              {can(session, ["billing:read", "radiology:report", "radiology:verify"]) && <Row label="Charge">{formatMoney(raw.price, h.currency)}</Row>}
              {raw.cancellation && <Row label="Cancelled"><span className="text-danger">{raw.cancellation.reason || "No reason recorded"}</span><span className="block text-xs text-muted">{raw.cancellation.by} · {formatDateTime(raw.cancellation.at, tz)}</span></Row>}
            </dl>
          </Card>
          <Card title="Clinical indication">
            {raw.indication ? <p className="text-[13.5px] whitespace-pre-wrap">{raw.indication}</p> : <p className="text-[13px] text-muted">No indication provided.</p>}
          </Card>
          {activity.length > 0 && (
            <Card title="Activity">
              <ol className="timeline">
                {activity.map((a) => (
                  <li key={a.id} className="timeline-item">
                    <p className="text-[13px] font-medium">{ACTIVITY_LABELS[a.action] || a.action}{a.metadata?.selfVerification && <Badge tone="warning" plain className="ml-1.5">Self-verified</Badge>}</p>
                    <p className="text-xs text-subtle">{a.user?.name || "System"} · {formatDateTime(a.createdAt, tz)}</p>
                    {a.metadata?.scheduledAt && <p className="text-xs text-muted">For {formatDateTime(a.metadata.scheduledAt, tz)}</p>}
                    {a.metadata?.reason && <p className="text-xs text-muted">Reason: {a.metadata.reason}</p>}
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

/** Existing future appointment, else the next quarter-hour at least 30 minutes from now. */
function defaultSlot(scheduledAt) {
  const now = Date.now();
  if (scheduledAt && new Date(scheduledAt).getTime() > now) return new Date(scheduledAt);
  return new Date(Math.ceil((now + 30 * 60000) / (15 * 60000)) * 15 * 60000);
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="text-muted text-xs font-semibold uppercase tracking-wide pt-0.5">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
