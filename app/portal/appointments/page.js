import { CalendarDays } from "lucide-react";
import { requirePortalSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { portalAppointments, listBookableDoctors, portalCancelBlocker, MAX_REQUEST_DAYS_AHEAD } from "@/lib/services/dashboard";
import { addDays, todayInTz, formatDateTime, formatDate } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { RequestAppointmentButton, CancelAppointmentButton } from "@/components/portal/PortalForms";

export const metadata = { title: "Appointments" };

const dr = (d) => `Dr. ${d.staff.firstName} ${d.staff.lastName}`;

export default async function PortalAppointmentsPage() {
  const session = await requirePortalSession();
  const h = await getHospital();
  const tz = h.timezone;
  const policy = h.settings.appointments;
  const [{ upcoming, past }, doctors] = await Promise.all([portalAppointments(session.patientId), listBookableDoctors()]);
  const today = todayInTz(tz);
  const when = (a) => (a.status === "REQUESTED"
    ? <span><span className="font-medium">{formatDate(a.startsAt, tz)}</span><span className="block text-xs text-muted">Requested — the hospital will confirm a time</span></span>
    : <span className="font-medium">{formatDateTime(a.startsAt, tz)}</span>);

  return (
    <>
      <PageHeader title="My appointments" description={`Online cancellation is possible up to ${policy.minCancelHours} hours before a confirmed appointment.`}
        actions={<RequestAppointmentButton doctors={doctors} enabled={!!policy.allowPatientRequests} minDate={addDays(today, 1)} maxDate={addDays(today, MAX_REQUEST_DAYS_AHEAD)} />} />
      <section className="card mb-5" aria-labelledby="up-h">
        <header className="card-header"><h2 id="up-h" className="card-title">Upcoming</h2></header>
        <DataTable rows={upcoming} caption="Upcoming appointments"
          empty={<EmptyState icon={CalendarDays} title="No upcoming appointments" description="Use “Request appointment” to ask for a visit." />}
          columns={[
            { key: "when", label: "Date & time", render: when },
            { key: "doctor", label: "Doctor", render: (a) => <span>{dr(a.doctor)}<span className="block text-xs text-muted">{a.doctor.specialty} · {a.department.name}</span></span> },
            { key: "reason", label: "Reason", render: (a) => a.reason || "—" },
            { key: "no", label: "Reference", render: (a) => <code className="text-[12px]">{a.appointmentNo}</code> },
            { key: "status", label: "Status", render: (a) => <StatusBadge status={a.status} /> },
            { key: "actions", label: "", render: (a) => {
              const blocker = portalCancelBlocker(a, Number(policy.minCancelHours ?? 0));
              return blocker ? <span className="text-xs text-subtle">{["SCHEDULED", "CONFIRMED"].includes(a.status) ? "Call to change" : ""}</span>
                : <CancelAppointmentButton id={a.id} label={`${dr(a.doctor)} on ${formatDate(a.startsAt, tz)}`} />;
            } },
          ]} />
      </section>
      <section className="card" aria-labelledby="past-h">
        <header className="card-header"><h2 id="past-h" className="card-title">History</h2></header>
        <DataTable rows={past} caption="Past and cancelled appointments" empty={<EmptyState title="No past appointments" />}
          columns={[
            { key: "when", label: "Date", render: (a) => formatDateTime(a.startsAt, tz) },
            { key: "doctor", label: "Doctor", render: (a) => dr(a.doctor) },
            { key: "dept", label: "Department", render: (a) => a.department.name },
            { key: "type", label: "Type", render: (a) => a.type.replace("_", " ").toLowerCase() },
            { key: "status", label: "Status", render: (a) => <span><StatusBadge status={a.status} />{a.status === "CANCELLED" && a.cancelReason && <span className="block text-xs text-muted mt-0.5">{a.cancelReason}</span>}</span> },
          ]} />
      </section>
    </>
  );
}
