import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, Siren, TestTube, History, FileText } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { getLabOrder, redactLabOrder, getLabOrderActivity, labValidationPolicy } from "@/lib/services/lab";
import { getHospital } from "@/lib/services/settings";
import { LAB_STATUS_LABELS, describeReference } from "@/lib/validation/lab";
import { formatDateTime } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { Card } from "@/components/ui/Card";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { PatientBanner } from "@/components/laboratory/PatientBanner";
import { LabOrderActions } from "@/components/laboratory/LabOrderActions";
import { ResultEntryForm } from "@/components/laboratory/ResultEntryForm";
import { CorrectResultButton } from "@/components/laboratory/CorrectResultButton";

export const metadata = { title: "Lab order" };

const ACTIVITY_LABELS = {
  "lab.order.create": "Order placed",
  "lab.specimen.collect": "Specimen collected",
  "lab.specimen.reject": "Specimen rejected",
  "lab.order.process": "Processing started",
  "lab.result.enter": "Results entered",
  "lab.result.correct": "Result corrected",
  "lab.order.release": "Validated and released",
  "lab.order.cancel": "Order cancelled",
};

export default async function LabOrderPage({ params }) {
  const session = await requirePageSession("lab:read");
  const { id } = await params;
  const raw = await getLabOrder(id);
  if (!raw) notFound();
  const h = await getHospital();
  const tz = h.timezone;
  await audit({ userId: session.user.id, action: "lab.order.view", entityType: "LabOrder", entityId: raw.id });

  const order = redactLabOrder(raw, session);
  const perms = {
    process: can(session, "lab:process"),
    validate: can(session, "lab:validate"),
    cancel: can(session, "lab:process") || (can(session, "lab:order") && !!session.doctorId && raw.doctorId === session.doctorId),
  };
  const isLabStaff = perms.process || perms.validate;
  const [activity, policy, portalLink] = await Promise.all([
    isLabStaff || can(session, "audit:read") ? getLabOrderActivity(id) : [],
    labValidationPolicy(),
    prisma.patientUserLink.findUnique({ where: { patientId: raw.patientId }, select: { verifiedAt: true } }),
  ]);
  const names = raw.userNames;
  const nameOf = (uid) => (uid ? names[uid] || "Unknown user" : "—");

  const items = order.items.map((it) => {
    const current = it.results.find((r) => r.isCurrent) || null;
    const history = it.results.filter((r) => !r.isCurrent);
    return { ...it, current, history };
  });
  const currentRaw = raw.items.flatMap((it) => it.results.filter((r) => r.isCurrent));
  const selfEnteredCount = currentRaw.filter((r) => !r.validatedAt && r.enteredById === session.user.id).length;
  const hasValidatedResults = currentRaw.some((r) => r.validatedAt);
  const specimenTypes = [...new Set(raw.items.map((i) => i.test.specimenType))];
  const tat = Math.max(...raw.items.map((i) => i.test.turnaroundHours), 0);
  const dueBy = new Date(new Date(raw.createdAt).getTime() + tat * 3600 * 1000);
  const active = ["REQUESTED", "SAMPLE_COLLECTED", "PROCESSING", "AWAITING_VALIDATION"].includes(raw.status);
  const overdue = active && dueBy < new Date();
  const showEntry = perms.process && ["PROCESSING", "AWAITING_VALIDATION"].includes(order.status);
  const canCorrect = perms.process && ["RELEASED", "AWAITING_VALIDATION"].includes(order.status);
  const historyRows = items.flatMap((it) => it.history.map((r) => ({ ...r, testName: it.test.name })));
  const doctorName = `Dr. ${raw.doctor.staff.firstName} ${raw.doctor.staff.lastName}`;

  return (
    <>
      <Link href="/laboratory" className="no-print inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ChevronLeft size={15} aria-hidden /> Laboratory worklist</Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-bold tracking-tight font-mono">{raw.orderNo}</h1>
            <StatusBadge status={raw.status} label={LAB_STATUS_LABELS[raw.status]} />
            {raw.priority !== "ROUTINE" && <Badge tone={raw.priority === "STAT" ? "danger" : "warning"}>{raw.priority === "STAT" && <Siren size={12} aria-hidden />}{raw.priority}</Badge>}
            {overdue && <Badge tone="danger" plain><Clock size={12} aria-hidden /> Overdue</Badge>}
          </div>
          <p className="text-[13px] text-muted mt-1">Ordered {formatDateTime(raw.createdAt, tz)} by {doctorName} · {raw.items.length} test{raw.items.length === 1 ? "" : "s"}</p>
        </div>
        <LabOrderActions
          order={{ id: raw.id, orderNo: raw.orderNo, status: raw.status, specimenTypes, hasValidatedResults, hasPortal: !!portalLink?.verifiedAt }}
          perms={perms} policy={{ requireSecondValidator: policy.requireSecondValidator, selfEnteredCount }} />
      </div>

      <PatientBanner patient={raw.patient} href={can(session, "patients:read") ? `/patients/${raw.patient.id}` : undefined} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card title="Tests & results" noPadding
            description={showEntry ? "Enter results as they become available. Flags compare numeric values with the configured reference range only." : order.status === "RELEASED" ? `Released ${formatDateTime(raw.releasedAt, tz)}` : undefined}
            actions={order.status === "RELEASED" && <Link href={`/laboratory/${raw.id}/report`} className="btn btn-secondary btn-sm"><FileText size={14} aria-hidden /> Report</Link>}>
            {showEntry ? (
              <ResultEntryForm orderId={raw.id} status={order.status} canCorrect={canCorrect}
                items={serialize(items.map((it) => ({ id: it.id, test: pickTest(it.test), current: it.current ? pickResult(it.current) : null })))} />
            ) : (
              <div className="table-wrap">
                <table className="table table-responsive">
                  <caption className="sr-only">Results</caption>
                  <thead><tr><th>Test</th><th className="num">Result</th><th>Unit</th><th>Reference</th><th>Flag</th><th>Comment</th>{canCorrect && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                  <tbody>
                    {items.map((it) => {
                      const r = it.current;
                      const pending = !r && it.history.length > 0 && order.status === "AWAITING_VALIDATION";
                      return (
                        <tr key={it.id}>
                          <td data-label="Test"><span className="font-medium">{it.test.name}</span> <span className="font-mono text-[11.5px] text-subtle">{it.test.code}</span></td>
                          <td data-label="Result" className="num font-semibold">
                            {r ? <span className={r.flag === "HIGH" || r.flag === "LOW" ? "text-danger" : ""}>{r.value}</span>
                              : <span className="text-subtle font-normal">{pending ? "Correction pending" : order.status === "CANCELLED" || order.status === "REJECTED" ? "—" : "Pending"}</span>}
                            {r && !r.validatedAt && <span className="block text-[11px] font-normal text-warning">Not yet validated</span>}
                          </td>
                          <td data-label="Unit">{r?.unit || it.test.unit || ""}</td>
                          <td data-label="Reference" className="text-muted">{r?.referenceRange || describeReference(it.test) || "—"}</td>
                          <td data-label="Flag">{r?.flag ? <StatusBadge status={r.flag} /> : <span className="text-subtle">—</span>}</td>
                          <td data-label="Comment" className="text-muted text-[13px]">{r?.comment || ""}</td>
                          {canCorrect && <td data-label="">{r?.validatedAt && <CorrectResultButton orderId={raw.id} released={order.status === "RELEASED"} item={serialize({ id: it.id, test: pickTest(it.test), current: pickResult(r) })} />}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {historyRows.length > 0 && (
            <Card title={<span className="inline-flex items-center gap-2"><History size={15} aria-hidden /> Result history</span>} noPadding description="Superseded values are retained and never deleted.">
              <div className="table-wrap">
                <table className="table table-responsive">
                  <thead><tr><th>Test</th><th className="num">Value</th><th>Flag</th><th>Entered</th><th>Validated</th><th>Reason superseded</th></tr></thead>
                  <tbody>
                    {historyRows.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Test">{r.testName}</td>
                        <td data-label="Value" className="num"><span className="line-through decoration-subtle">{r.value}</span> {r.unit}</td>
                        <td data-label="Flag">{r.flag ? <StatusBadge status={r.flag} /> : "—"}</td>
                        <td data-label="Entered" className="text-[12.5px]">{nameOf(r.enteredById)}<span className="block text-subtle">{formatDateTime(r.enteredAt, tz)}</span></td>
                        <td data-label="Validated" className="text-[12.5px]">{r.validatedAt ? <>{nameOf(r.validatedById)}<span className="block text-subtle">{formatDateTime(r.validatedAt, tz)}</span></> : "—"}</td>
                        <td data-label="Reason" className="text-[12.5px] text-muted">{r.correctionReason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card title="Order details">
            <dl className="space-y-3 text-[13px]">
              <Row label="Ordering doctor">{doctorName}<span className="block text-xs text-muted">{raw.doctor.specialty}{raw.doctor.department?.name ? ` · ${raw.doctor.department.name}` : ""}</span></Row>
              <Row label="Priority"><StatusBadge status={raw.priority} label={raw.priority === "STAT" ? "STAT" : undefined} /></Row>
              <Row label="Ordered">{formatDateTime(raw.createdAt, tz)}</Row>
              <Row label="Expected by"><span className={overdue ? "text-danger font-semibold" : ""}>{formatDateTime(dueBy, tz)}</span><span className="block text-xs text-muted">Longest turnaround {tat} h</span></Row>
              {raw.encounter && <Row label="Encounter">{can(session, "clinical:read") ? <Link href={`/consultations/${raw.encounter.id}`} className="font-mono text-primary hover:underline">{raw.encounter.encounterNo}</Link> : <span className="font-mono">{raw.encounter.encounterNo}</span>} <StatusBadge status={raw.encounter.status} /></Row>}
              {raw.releasedAt && <Row label={raw.status === "RELEASED" ? "Released" : "Last released"}>{formatDateTime(raw.releasedAt, tz)}<span className="block text-xs text-muted">by {nameOf(raw.releasedById)}</span></Row>}
              {raw.cancelReason && <Row label={raw.status === "REJECTED" ? "Rejection reason" : "Cancellation reason"}><span className="text-danger">{raw.cancelReason}</span></Row>}
            </dl>
          </Card>

          <Card title="Clinical notes">
            {raw.clinicalNotes ? <p className="text-[13.5px] whitespace-pre-wrap">{raw.clinicalNotes}</p> : <p className="text-[13px] text-muted">No clinical notes provided.</p>}
          </Card>

          <Card title={<span className="inline-flex items-center gap-2"><TestTube size={15} aria-hidden /> Specimens</span>} noPadding>
            {raw.specimens.length === 0 ? (
              <EmptyState title="No specimen collected" description={`Required: ${specimenTypes.join(", ")}`} />
            ) : (
              <ul className="divide-y divide-border">
                {raw.specimens.map((s) => (
                  <li key={s.id} className="px-4 py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold">{s.specimenNo}</span>
                      <StatusBadge status={s.status === "REJECTED" ? "REJECTED" : "SAMPLE_COLLECTED"} label={s.status === "REJECTED" ? "Rejected" : "Collected"} />
                    </div>
                    <p className="text-muted">{s.type}</p>
                    <p className="text-xs text-subtle">{formatDateTime(s.collectedAt, tz)} · {nameOf(s.collectedById)}</p>
                    {s.rejectionReason && <p className="text-xs text-danger mt-1">Rejected: {s.rejectionReason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {activity.length > 0 && (
            <Card title="Activity">
              <ol className="timeline">
                {activity.map((a) => (
                  <li key={a.id} className="timeline-item">
                    <p className="text-[13px] font-medium">{ACTIVITY_LABELS[a.action] || a.action}{a.metadata?.selfValidation && <Badge tone="warning" plain className="ml-1.5">Self-validated</Badge>}</p>
                    <p className="text-xs text-subtle">{a.user?.name || "System"} · {formatDateTime(a.createdAt, tz)}</p>
                    {a.metadata?.reason && <p className="text-xs text-muted mt-0.5">Reason: {a.metadata.reason}</p>}
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

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="text-muted text-xs font-semibold uppercase tracking-wide pt-0.5">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function pickTest(t) {
  return { code: t.code, name: t.name, unit: t.unit, referenceLow: t.referenceLow, referenceHigh: t.referenceHigh, referenceText: t.referenceText };
}
function pickResult(r) {
  return { id: r.id, value: r.value, unit: r.unit, comment: r.comment, flag: r.flag, validatedAt: r.validatedAt };
}
