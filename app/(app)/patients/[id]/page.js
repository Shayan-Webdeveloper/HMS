import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Phone, Mail, MapPin, Droplet, FileText } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getPatientProfile, getPatientTimeline } from "@/lib/services/patients";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { ageFromDob, formatDate, formatDateTime, formatDateOnly, toZonedDateString } from "@/lib/utils/time";
import { formatMoney, D } from "@/lib/utils/money";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LinkTabs } from "@/components/ui/Tabs";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState, ForbiddenState } from "@/components/ui/States";
import { PatientActions } from "@/components/patients/PatientActions";
import { AllergyPanel } from "@/components/patients/AllergyPanel";
import { FileUploader } from "@/components/shared/FileUploader";

export const metadata = { title: "Patient" };

export default async function PatientProfilePage({ params, searchParams }) {
  const session = await requirePageSession("patients:read");
  const { id } = await params;
  const sp = await searchParams;
  const p = await getPatientProfile(id);
  if (!p) notFound();
  if (p.status === "MERGED" && p.mergedIntoId) redirect(`/patients/${p.mergedIntoId}`);
  const h = await getHospital();
  const tz = h.timezone;
  const clinical = can(session, "clinical:read");
  const billing = can(session, "billing:read");
  await audit({ userId: session.user.id, action: "patient.view", entityType: "Patient", entityId: p.id });

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "demographics", label: "Demographics" },
    { key: "appointments", label: "Appointments", count: p._count.appointments },
    clinical && { key: "encounters", label: "Encounters", count: p._count.encounters },
    clinical && { key: "history", label: "Medical history" },
    (clinical || can(session, "prescriptions:read")) && { key: "prescriptions", label: "Prescriptions", count: p._count.prescriptions },
    (clinical || can(session, "lab:read")) && { key: "labs", label: "Lab results", count: p._count.labOrders },
    (clinical || can(session, "radiology:read")) && { key: "imaging", label: "Imaging" },
    can(session, "admissions:read") && { key: "admissions", label: "Admissions", count: p._count.admissions },
    clinical && { key: "documents", label: "Documents", count: p._count.documents },
    billing && { key: "billing", label: "Billing", count: p._count.invoices },
    can(session, "insurance:read") && { key: "insurance", label: "Insurance" },
    can(session, "audit:read") && { key: "audit", label: "Access log" },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab : "overview";
  const age = ageFromDob(p.dateOfBirth);

  return (
    <>
      {/* Patient banner */}
      <div className="card p-5 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
          <div className="flex gap-4 min-w-0">
            <div className="w-14 h-14 rounded-full bg-primary-soft text-primary-ink font-bold text-lg flex items-center justify-center shrink-0">
              {p.firstName[0]}{p.lastName[0]}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[21px] font-bold tracking-tight">{p.firstName} {p.lastName}</h1>
                <StatusBadge status={p.status} />
                {p.userLink?.verifiedAt && <Badge tone="teal" plain>Portal user</Badge>}
              </div>
              <p className="text-[13px] text-muted mt-0.5">
                <span className="font-mono font-semibold text-ink">{p.mrn}</span> · {age != null ? `${age} y` : "Age unknown"} · {p.sex === "UNKNOWN" ? "Sex not recorded" : p.sex.toLowerCase()}
                {p.dateOfBirth && <> · DOB {formatDateOnly(p.dateOfBirth)}</>}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted">
                {p.phone && <span className="inline-flex items-center gap-1"><Phone size={13} />{p.phone}</span>}
                {p.email && <span className="inline-flex items-center gap-1"><Mail size={13} />{p.email}</span>}
                {p.city && <span className="inline-flex items-center gap-1"><MapPin size={13} />{p.city}</span>}
                {p.bloodGroup && <span className="inline-flex items-center gap-1"><Droplet size={13} />{p.bloodGroup}</span>}
              </div>
            </div>
          </div>
          <PatientActions patient={{ id: p.id, mrn: p.mrn, status: p.status }} canEdit={can(session, "patients:update")} canArchive={can(session, "patients:archive")} canBook={can(session, "appointments:create")} canMerge={can(session, "patients:merge")} />
        </div>
        {p.medicalAlerts && (
          <div className="mt-4 rounded-lg bg-warning-soft border border-warning/30 px-3 py-2 text-[13px] text-warning font-medium flex items-start gap-2" role="note">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {p.medicalAlerts}
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-2">Allergies</p>
          <AllergyPanel patientId={p.id} allergies={p.allergies.map((a) => ({ id: a.id, substance: a.substance, reaction: a.reaction, severity: a.severity }))} canEdit={can(session, ["encounters:create", "patients:update"])} />
        </div>
      </div>

      <div className="card">
        <LinkTabs tabs={tabs} active={tab} baseHref={`/patients/${p.id}`} />
        <div className="p-0">
          <TabContent tab={tab} p={p} tz={tz} session={session} currency={h.currency} clinical={clinical} />
        </div>
      </div>
    </>
  );
}

async function TabContent({ tab, p, tz, session, currency, clinical }) {
  const money = (v) => formatMoney(v, currency);
  switch (tab) {
    case "overview": {
      const ev = await getPatientTimeline(p.id, { clinical });
      const latestVitals = clinical ? await prisma.vitalSign.findFirst({ where: { patientId: p.id }, orderBy: { recordedAt: "desc" } }) : null;
      return (
        <div className="grid lg:grid-cols-[1fr_320px] gap-0">
          <div className="p-5">
            <h3 className="font-semibold mb-4">Timeline</h3>
            {ev.length === 0 ? <EmptyState title="No activity yet" description="Appointments, visits, admissions and invoices will appear here." /> : (
              <ol className="timeline">
                {ev.map((e, i) => (
                  <li key={i} className="timeline-item">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-muted uppercase tracking-wide">{e.type}</span>
                      <StatusBadge status={e.status} />
                      <span className="text-xs text-subtle">{formatDateTime(e.at, tz)}</span>
                    </div>
                    <Link href={e.href} className="text-[13.5px] font-medium hover:text-primary">{e.title}</Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <aside className="border-t lg:border-t-0 lg:border-l border-border p-5 space-y-5">
            {latestVitals && (
              <div>
                <h3 className="font-semibold mb-2 text-[13.5px]">Latest vitals <span className="text-xs text-subtle font-normal">{formatDateTime(latestVitals.recordedAt, tz)}</span></h3>
                <dl className="grid grid-cols-2 gap-2 text-[13px]">
                  <div><dt className="text-muted text-xs">BP</dt><dd className="font-semibold tabular">{latestVitals.systolic ?? "—"}/{latestVitals.diastolic ?? "—"}</dd></div>
                  <div><dt className="text-muted text-xs">Pulse</dt><dd className="font-semibold tabular">{latestVitals.pulse ?? "—"}</dd></div>
                  <div><dt className="text-muted text-xs">Temp °C</dt><dd className="font-semibold tabular">{latestVitals.temperatureC?.toString() ?? "—"}</dd></div>
                  <div><dt className="text-muted text-xs">SpO₂ %</dt><dd className="font-semibold tabular">{latestVitals.spo2 ?? "—"}</dd></div>
                </dl>
              </div>
            )}
            <div>
              <h3 className="font-semibold mb-2 text-[13.5px]">Emergency contact</h3>
              {p.emergencyContacts.length ? p.emergencyContacts.map((c) => <p key={c.id} className="text-[13px]">{c.name} {c.relationship && <span className="text-muted">({c.relationship})</span>}<br /><span className="text-muted">{c.phone}</span></p>) : <p className="text-[13px] text-muted">Not recorded</p>}
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-[13.5px]">Registration</h3>
              <p className="text-[13px] text-muted">Registered {formatDate(p.registeredAt, tz)}</p>
              <p className="text-[13px] text-muted">SMS consent: {p.consentToSms ? "Yes" : "No"} · Email consent: {p.consentToEmail ? "Yes" : "No"}</p>
            </div>
          </aside>
        </div>
      );
    }
    case "demographics":
      return (
        <div className="p-5">
          <dl className="dl-grid">
            {[["First name", p.firstName], ["Last name", p.lastName], ["Date of birth", p.dateOfBirth ? formatDateOnly(p.dateOfBirth) : "—"], ["Sex", p.sex], ["Phone", p.phone], ["Email", p.email], ["Address", p.address], ["City", p.city], ["Blood group", p.bloodGroup], ["Status", p.status], ["Registered", formatDateTime(p.registeredAt, tz)], ["Last updated", formatDateTime(p.updatedAt, tz)]].map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>
            ))}
          </dl>
        </div>
      );
    case "appointments": {
      const rows = await prisma.appointment.findMany({ where: { patientId: p.id }, orderBy: { startsAt: "desc" }, take: 100, include: { doctor: { include: { staff: true } }, department: true } });
      return <DataTable rows={rows} empty={<EmptyState title="No appointments" />} columns={[
        { key: "no", label: "No.", render: (r) => <Link className="font-mono text-[12.5px] text-primary font-semibold" href={`/appointments/${r.id}`}>{r.appointmentNo}</Link> },
        { key: "when", label: "Date & time", render: (r) => formatDateTime(r.startsAt, tz) },
        { key: "doctor", label: "Doctor", render: (r) => `Dr. ${r.doctor.staff.firstName} ${r.doctor.staff.lastName}` },
        { key: "dept", label: "Department", render: (r) => r.department.name },
        { key: "type", label: "Type", render: (r) => r.type.replace("_", " ").toLowerCase() },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]} />;
    }
    case "encounters": {
      const rows = await prisma.encounter.findMany({ where: { patientId: p.id }, orderBy: { startedAt: "desc" }, take: 100, include: { doctor: { include: { staff: true } }, diagnoses: true } });
      return <DataTable rows={rows} empty={<EmptyState title="No encounters" />} columns={[
        { key: "no", label: "Encounter", render: (r) => <Link className="font-mono text-[12.5px] text-primary font-semibold" href={`/consultations/${r.id}`}>{r.encounterNo}</Link> },
        { key: "date", label: "Date", render: (r) => formatDateTime(r.startedAt, tz) },
        { key: "type", label: "Type", render: (r) => r.type },
        { key: "doctor", label: "Clinician", render: (r) => `Dr. ${r.doctor.staff.firstName} ${r.doctor.staff.lastName}` },
        { key: "dx", label: "Diagnosis", render: (r) => r.diagnoses.map((d) => `${d.code ? d.code + " " : ""}${d.description}`).join("; ") || "—" },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]} />;
    }
    case "history":
      return (
        <div className="p-5">
          {p.medicalHistory.length === 0 ? <EmptyState title="No medical history recorded" description="History is added by clinicians during consultations." /> : (
            <ul className="divide-y divide-border">
              {p.medicalHistory.map((m) => (
                <li key={m.id} className="py-3 flex items-start justify-between gap-4">
                  <div><Badge tone="info" plain>{m.category.replace("_", " ").toLowerCase()}</Badge><p className="mt-1 text-[13.5px]">{m.description}</p></div>
                  <span className="text-xs text-subtle whitespace-nowrap">{m.onsetDate ? `Onset ${formatDateOnly(m.onsetDate)}` : formatDate(m.createdAt, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case "prescriptions": {
      const rows = await prisma.prescription.findMany({ where: { patientId: p.id }, orderBy: { createdAt: "desc" }, take: 100, include: { items: { include: { medication: true } }, doctor: { include: { staff: true } } } });
      return <DataTable rows={rows} empty={<EmptyState title="No prescriptions" />} columns={[
        { key: "no", label: "Rx", render: (r) => <Link className="font-mono text-[12.5px] text-primary font-semibold" href={`/pharmacy/prescriptions/${r.id}`}>{r.prescriptionNo}</Link> },
        { key: "date", label: "Date", render: (r) => formatDate(r.createdAt, tz) },
        { key: "meds", label: "Medicines", render: (r) => r.items.map((i) => `${i.medication.genericName} ${i.medication.strength} — ${i.dose}, ${i.frequency} × ${i.durationDays}d`).join("; ") },
        { key: "doc", label: "Prescriber", render: (r) => `Dr. ${r.doctor.staff.lastName}` },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]} />;
    }
    case "labs": {
      const rows = await prisma.labOrder.findMany({ where: { patientId: p.id }, orderBy: { createdAt: "desc" }, take: 50, include: { items: { include: { test: true, results: { where: { isCurrent: true } } } } } });
      if (!rows.length) return <EmptyState title="No laboratory orders" />;
      return (
        <div className="divide-y divide-border">
          {rows.map((o) => (
            <div key={o.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Link href={`/laboratory/${o.id}`} className="font-mono text-[12.5px] text-primary font-semibold">{o.orderNo}</Link>
                <StatusBadge status={o.status} /><StatusBadge status={o.priority} />
                <span className="text-xs text-subtle">{formatDateTime(o.createdAt, tz)}</span>
              </div>
              <table className="table">
                <thead><tr><th>Test</th><th className="num">Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
                <tbody>
                  {o.items.map((it) => {
                    const r = o.status === "RELEASED" ? it.results[0] : null;
                    return (
                      <tr key={it.id}>
                        <td>{it.test.name}</td>
                        <td className="num font-semibold">{r ? r.value : <span className="text-subtle font-normal">{o.status === "RELEASED" ? "—" : "Pending"}</span>}</td>
                        <td>{r?.unit || it.test.unit || ""}</td>
                        <td className="text-muted">{r?.referenceRange || "—"}</td>
                        <td>{r?.flag ? <StatusBadge status={r.flag} /> : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }
    case "imaging": {
      const rows = await prisma.imagingStudy.findMany({ where: { patientId: p.id }, orderBy: { createdAt: "desc" }, include: { report: true } });
      return <DataTable rows={rows} empty={<EmptyState title="No imaging studies" />} columns={[
        { key: "no", label: "Study", render: (r) => <Link className="font-mono text-[12.5px] text-primary font-semibold" href={`/radiology/${r.id}`}>{r.studyNo}</Link> },
        { key: "mod", label: "Modality", render: (r) => `${r.modality} — ${r.bodyPart}` },
        { key: "date", label: "Requested", render: (r) => formatDate(r.createdAt, tz) },
        { key: "imp", label: "Impression", render: (r) => (r.status === "VERIFIED" ? r.report?.impression : "—") },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]} />;
    }
    case "admissions": {
      const rows = await prisma.admission.findMany({ where: { patientId: p.id }, orderBy: { admittedAt: "desc" }, include: { bedAssignments: { include: { bed: { include: { ward: true } } }, orderBy: { startedAt: "desc" }, take: 1 } } });
      return <DataTable rows={rows} empty={<EmptyState title="No admissions" />} columns={[
        { key: "no", label: "Admission", render: (r) => <Link className="font-mono text-[12.5px] text-primary font-semibold" href={`/admissions/${r.id}`}>{r.admissionNo}</Link> },
        { key: "in", label: "Admitted", render: (r) => formatDateTime(r.admittedAt, tz) },
        { key: "out", label: "Discharged", render: (r) => formatDateTime(r.dischargedAt, tz) },
        { key: "bed", label: "Bed", render: (r) => (r.bedAssignments[0] ? `${r.bedAssignments[0].bed.ward.name} · ${r.bedAssignments[0].bed.label}` : "—") },
        { key: "reason", label: "Reason", render: (r) => r.reason },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
      ]} />;
    }
    case "documents": {
      const docs = await prisma.uploadedDocument.findMany({ where: { patientId: p.id }, orderBy: { createdAt: "desc" } });
      return (
        <div>
          {can(session, ["patients:update", "encounters:create"]) && <div className="p-4 border-b border-border"><FileUploader patientId={p.id} /></div>}
          <DataTable rows={docs} empty={<EmptyState icon={FileText} title="No documents" description="Uploaded referrals, reports and consent forms appear here." />} columns={[
            { key: "name", label: "File", render: (d) => <a className="text-primary font-medium hover:underline" href={`/api/documents/${d.id}`} target="_blank" rel="noopener noreferrer">{d.originalName}</a> },
            { key: "cat", label: "Category", render: (d) => d.category.replace(/_/g, " ").toLowerCase() },
            { key: "size", label: "Size", render: (d) => `${(d.sizeBytes / 1024).toFixed(0)} KB` },
            { key: "at", label: "Uploaded", render: (d) => formatDateTime(d.createdAt, tz) },
          ]} />
        </div>
      );
    }
    case "billing": {
      const rows = await prisma.invoice.findMany({ where: { patientId: p.id }, orderBy: { createdAt: "desc" }, take: 100 });
      const outstanding = rows.filter((r) => ["ISSUED", "PARTIALLY_PAID"].includes(r.status)).reduce((s, r) => s.plus(r.balance), D(0));
      return (
        <div>
          <div className="px-5 py-3 border-b border-border text-[13.5px] flex items-center justify-between gap-3">
            <span>Outstanding balance: <span className="font-bold tabular">{money(outstanding)}</span></span>
            {can(session, "billing:create") && <Button size="sm" variant="primary" href={`/billing/new?patientId=${p.id}`}>New invoice</Button>}
          </div>
          <DataTable rows={rows} empty={<EmptyState title="No invoices" />} columns={[
            { key: "no", label: "Invoice", render: (r) => <Link className="font-mono text-[12.5px] text-primary font-semibold" href={`/billing/${r.id}`}>{r.invoiceNo}</Link> },
            { key: "date", label: "Date", render: (r) => formatDate(r.createdAt, tz) },
            { key: "total", label: "Total", align: "right", render: (r) => money(r.total) },
            { key: "paid", label: "Paid", align: "right", render: (r) => money(r.amountPaid) },
            { key: "bal", label: "Balance", align: "right", render: (r) => money(r.balance) },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </div>
      );
    }
    case "insurance": {
      const rows = await prisma.insurancePolicy.findMany({ where: { patientId: p.id }, include: { provider: true } });
      return <DataTable rows={rows} empty={<EmptyState title="No insurance policies" />} columns={[
        { key: "prov", label: "Provider", render: (r) => r.provider.name },
        { key: "no", label: "Policy no.", render: (r) => r.policyNumber },
        { key: "cov", label: "Coverage", render: (r) => `${formatDateOnly(r.coverageStart)} – ${formatDateOnly(r.coverageEnd)}` },
        { key: "notes", label: "Notes", render: (r) => r.coverageNotes || "—" },
        // coverageEnd is a calendar date: compare as dates in the hospital time zone, not instants.
        { key: "act", label: "Status", render: (r) => <StatusBadge status={r.isActive && r.coverageEnd.toISOString().slice(0, 10) >= toZonedDateString(new Date(), tz) ? "ACTIVE" : "INACTIVE"} /> },
      ]} />;
    }
    case "audit": {
      if (!can(session, "audit:read")) return <ForbiddenState />;
      const rows = await prisma.auditLog.findMany({ where: { entityType: "Patient", entityId: p.id }, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true } } } });
      return <DataTable rows={rows} empty={<EmptyState title="No access recorded" />} columns={[
        { key: "at", label: "When", render: (r) => formatDateTime(r.createdAt, tz) },
        { key: "who", label: "User", render: (r) => r.user?.name || "System" },
        { key: "action", label: "Action", render: (r) => <code className="text-[12px]">{r.action}</code> },
        { key: "meta", label: "Details", render: (r) => (r.metadata?.fields ? `Fields: ${r.metadata.fields.join(", ")}` : r.metadata?.reason ? `Reason: ${r.metadata.reason}` : "—") },
      ]} />;
    }
    default:
      return null;
  }
}
