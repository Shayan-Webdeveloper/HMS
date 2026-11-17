import { requirePlatformSession } from "@/lib/auth/session";
import { listHospitals, listPlatformAudit } from "@/lib/services/platform";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { ChangePasswordForm } from "@/components/shared/ChangePasswordForm";
import { CreateHospitalForm, HospitalActions, HospitalStatus, ResetAccountPassword } from "@/components/platform/PlatformConsole";
import { formatDateTime } from "@/lib/utils/time";

export const metadata = { title: "Hospitals" };

export default async function PlatformPage() {
  const session = await requirePlatformSession({ allowPasswordChange: true });
  if (session.user.mustChangePassword) {
    return (
      <>
        <PageHeader title="Set your password" description="Your account was created with a temporary password." />
        <Card title="Change password"><ChangePasswordForm /></Card>
      </>
    );
  }
  const [hospitals, events] = await Promise.all([listHospitals(), listPlatformAudit({ take: 50 })]);
  return (
    <>
      <PageHeader title="Hospitals" description="Register hospitals and appoint their administrators. Each hospital's patient, clinical, financial and staff records are visible only inside that hospital — not here." />
      <div className="space-y-5">
        <Card title="Registered hospitals" noPadding>
          <DataTable rows={hospitals} empty={<EmptyState title="No hospitals yet" description="Create the first hospital below." />} columns={[
            { key: "name", label: "Hospital", render: (h) => <div><p className="font-semibold">{h.name}</p><p className="text-xs text-muted font-mono">{h.code}</p></div> },
            { key: "status", label: "Status", render: (h) => <HospitalStatus active={h.isActive} /> },
            { key: "members", label: "Active members", render: (h) => <span className="tabular">{h.activeMembers}</span> },
            { key: "tz", label: "Time zone / currency", render: (h) => `${h.timezone} · ${h.currency}` },
            { key: "created", label: "Created", render: (h) => formatDateTime(h.createdAt, "UTC") },
            { key: "actions", label: <span className="sr-only">Actions</span>, render: (h) => <HospitalActions hospital={{ id: h.id, name: h.name, isActive: h.isActive }} /> },
          ]} />
        </Card>
        <div className="grid lg:grid-cols-2 gap-5">
          <Card title="Register a hospital" description="Creates the hospital with its main facility, default settings and default role permissions."><CreateHospitalForm /></Card>
          <Card title="Account password reset" description="For accounts shared by several hospitals (hospital administrators cannot reset those). Signs the account out everywhere."><ResetAccountPassword /></Card>
        </div>
        <Card title="Platform activity" description="Platform-level events only. Each hospital's own audit trail is visible only inside that hospital." noPadding>
          <DataTable rows={events} empty={<EmptyState title="No platform events yet" />} columns={[
            { key: "at", label: "When", render: (e) => formatDateTime(e.createdAt, "UTC") },
            { key: "who", label: "User", render: (e) => e.user?.name ?? "—" },
            { key: "action", label: "Action", render: (e) => <code className="text-xs">{e.action}</code> },
            { key: "entity", label: "Entity", render: (e) => `${e.entityType}${e.entityId ? ` · ${e.entityId.slice(0, 10)}…` : ""}` },
          ]} />
        </Card>
      </div>
    </>
  );
}
