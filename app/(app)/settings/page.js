import { Info, ShieldCheck, Clock, KeyRound, Lock, Gauge, Hash } from "lucide-react";
import { requirePageSession, can } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { listUsers, listRoles, getPermissionMatrix, settingDefaults, getSettingMeta } from "@/lib/services/users";
import { userListQuery } from "@/lib/validation/users";
import { PASSWORD_POLICY_TEXT } from "@/lib/auth/password";
import { ID_FORMATS } from "@/lib/ids";
import { formatDateTime } from "@/lib/utils/time";
import { serialize } from "@/lib/utils/serialize";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkTabs } from "@/components/ui/Tabs";
import { Card } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/States";
import { HospitalProfileForm, AppointmentPolicyForm, BillingSettingsForm, PharmacySettingsForm, LabSettingsForm, TriageEditor } from "@/components/settings/SettingsForms";
import { CreateUserButton, UserRowActions } from "@/components/settings/UserManagement";
import { RoleMatrix } from "@/components/settings/RoleMatrix";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }) {
  const session = await requirePageSession(["settings:read", "users:manage"]);
  const sp = await searchParams;
  const readSettings = can(session, "settings:read");
  const manage = can(session, "settings:manage");
  const users = can(session, "users:manage");
  const tabs = [
    readSettings && { key: "general", label: "Hospital" },
    readSettings && { key: "operations", label: "Clinical & operations" },
    readSettings && { key: "billing", label: "Billing" },
    readSettings && { key: "identifiers", label: "Identifiers" },
    users && { key: "users", label: "Users" },
    users && { key: "roles", label: "Roles & permissions" },
    { key: "security", label: "Security" },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab : tabs[0].key;
  const h = await getHospital();

  return (
    <>
      <PageHeader title="Settings" description={manage ? "Hospital configuration, users and access control. Every change is audited." : readSettings ? "Hospital configuration (read-only for your role)." : "User accounts and access control."} />
      <div className="card">
        <LinkTabs tabs={tabs} active={tab} baseHref="/settings" />
        <Tab tab={tab} session={session} sp={sp} h={h} manage={manage} />
      </div>
    </>
  );
}

const fmtUpdated = (meta, key, tz) => (meta[key] ? `Last changed ${formatDateTime(meta[key].updatedAt, tz)}${meta[key].updatedBy ? ` by ${meta[key].updatedBy}` : ""}` : "Using defaults");
const merged = (h, key) => ({ ...settingDefaults(key), ...(h.settings[key] || {}) });

async function Tab({ tab, session, sp, h, manage }) {
  const tz = h.timezone;
  switch (tab) {
    case "general": {
      const meta = await getSettingMeta();
      return (
        <div className="p-5 max-w-3xl">
          <HospitalProfileForm canEdit={manage} updated={fmtUpdated(meta, "hospital.profile", tz)}
            hospital={{ name: h.name, address: h.address, phone: h.phone, email: h.email, timezone: h.timezone, currency: h.currency, locale: h.locale }} />
        </div>
      );
    }
    case "operations": {
      const meta = await getSettingMeta();
      return (
        <div className="p-5 grid xl:grid-cols-2 gap-5">
          <Card title="Appointment policy" description="Clinic hours, slot length and patient self-service rules."><AppointmentPolicyForm canEdit={manage} value={merged(h, "appointments")} updated={fmtUpdated(meta, "appointments", tz)} /></Card>
          <Card title="Emergency triage categories" description="Shown to triage staff and on the emergency board."><TriageEditor canEdit={manage} value={merged(h, "emergency")} updated={fmtUpdated(meta, "emergency", tz)} /></Card>
          <Card title="Pharmacy"><PharmacySettingsForm canEdit={manage} value={merged(h, "pharmacy")} updated={fmtUpdated(meta, "pharmacy", tz)} /></Card>
          <Card title="Laboratory"><LabSettingsForm canEdit={manage} value={merged(h, "lab")} updated={fmtUpdated(meta, "lab", tz)} /></Card>
        </div>
      );
    }
    case "billing": {
      const meta = await getSettingMeta();
      return (
        <div className="p-5 max-w-3xl">
          <BillingSettingsForm canEdit={manage} value={merged(h, "billing")} updated={fmtUpdated(meta, "billing", tz)} />
          <p className="text-xs text-muted mt-4">Currency is set on the Hospital tab ({h.currency}). Amounts are stored as exact decimals; tax is calculated per invoice line on the discounted amount.</p>
        </div>
      );
    }
    case "identifiers": {
      const year = new Date().getUTCFullYear();
      const rows = Object.entries(ID_FORMATS).map(([kind, f]) => ({ id: kind, kind, ...f, example: f.yearly ? `${f.prefix}-${year}-${"1".padStart(f.width, "0")}` : `${f.prefix}-${"1".padStart(f.width, "0")}` }));
      return (
        <div>
          <div className="mx-5 mt-5 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-[13px] text-info flex gap-2">
            <Info size={16} className="shrink-0 mt-0.5" aria-hidden />
            <p>Identifier formats are fixed in code (<code>lib/ids.js</code>) and are <strong>not configurable here</strong>. Numbers come from atomic database sequences, so they are never reused; yearly formats restart at 1 each calendar year. Changing a prefix requires a code change and deployment.</p>
          </div>
          <DataTable rows={rows} caption="Identifier formats" columns={[
            { key: "kind", label: "Record type", render: (r) => <span className="font-medium">{r.kind.replace(/([A-Z])/g, " $1").replace(/^\w/, (c) => c.toUpperCase())}</span> },
            { key: "prefix", label: "Prefix", render: (r) => <code className="font-semibold">{r.prefix}</code> },
            { key: "width", label: "Digits", align: "right", render: (r) => r.width },
            { key: "yearly", label: "Resets yearly", render: (r) => (r.yearly ? <Badge tone="info" plain>Yes</Badge> : <Badge tone="neutral" plain>No</Badge>) },
            { key: "example", label: "Example", render: (r) => <code className="text-[12.5px]">{r.example}</code> },
          ]} />
        </div>
      );
    }
    case "users": {
      const q = userListQuery.safeParse({ q: sp.q, role: sp.role, status: sp.status, page: sp.page });
      const query = q.success ? q.data : userListQuery.parse({});
      const [{ rows, meta }, roles] = await Promise.all([listUsers(query), listRoles()]);
      const actorIsSuper = session.roles.includes("SUPER_ADMIN");
      const params = { tab: "users", q: query.q, role: query.role, status: query.status };
      return (
        <div>
          <FilterBar placeholder="Search name or email…"
            filters={[{ name: "role", label: "Role", options: roles.map((r) => ({ value: r.key, label: r.name })) }, { name: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Deactivated" }] }]}>
            <CreateUserButton roles={roles} actorIsSuper={actorIsSuper} />
          </FilterBar>
          <DataTable rows={rows} caption="Users" path="/settings" params={params}
            empty={<EmptyState title="No users match" description="Try another search or filter." />}
            columns={[
              { key: "name", label: "User", render: (u) => (
                <div className="min-w-0 text-right sm:text-left">
                  <p className="font-medium">{u.name}{u.id === session.user.id && <span className="text-xs text-subtle font-normal"> (you)</span>}</p>
                  <p className="text-xs text-muted">{u.email}</p>
                </div>
              ) },
              { key: "roles", label: "Roles", render: (u) => <div className="flex flex-wrap gap-1 justify-end sm:justify-start">{u.roleNames.map((n, i) => <Badge key={u.roles[i]} tone={u.roles[i] === "SUPER_ADMIN" ? "danger" : u.roles[i] === "PATIENT" ? "teal" : "primary"} plain>{n}</Badge>)}</div> },
              { key: "link", label: "Linked record", render: (u) => (u.staff ? <span className="text-xs text-muted">Staff {u.staff.employeeNo}</span> : u.patientLink ? <span className="text-xs">Patient <code className="font-semibold">{u.patientLink.patient.mrn}</code>{!u.patientLink.verifiedAt && <Badge tone="warning" plain className="ml-1">unverified</Badge>}</span> : <span className="text-xs text-subtle">—</span>) },
              { key: "status", label: "Status", render: (u) => (
                <div className="flex flex-wrap gap-1 justify-end sm:justify-start">
                  <StatusBadge status={u.isActive ? "ACTIVE" : "INACTIVE"} label={u.isActive ? "Active" : "Deactivated"} />
                  {u.mustChangePassword && <Badge tone="warning" plain>Temp password</Badge>}
                  {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="danger" plain>Locked</Badge>}
                </div>
              ) },
              { key: "lastLoginAt", label: "Last sign-in", render: (u) => <span className="text-[13px] whitespace-nowrap">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, tz) : "Never"}</span> },
              { key: "actions", label: "", render: (u) => <UserRowActions user={serialize(u)} roles={roles} actorId={session.user.id} actorIsSuper={actorIsSuper} /> },
            ]} />
          <Pagination path="/settings" params={params} meta={meta} />
        </div>
      );
    }
    case "roles": {
      const m = await getPermissionMatrix();
      return <RoleMatrix roles={m.roles} permissions={m.permissions} canEdit={session.roles.includes("SUPER_ADMIN")} />;
    }
    case "security":
    default: {
      const maxAge = Number(process.env.SESSION_MAX_AGE_HOURS || 12);
      const idle = Number(process.env.SESSION_IDLE_MINUTES || 60);
      const facts = [
        { icon: KeyRound, title: "Password policy", body: PASSWORD_POLICY_TEXT, sub: "Passwords are hashed with bcrypt (cost 12). Administrators never see existing passwords; resets issue a one-time temporary password that must be changed at next sign-in." },
        { icon: Clock, title: "Sessions", body: `Signed out after ${idle} minutes of inactivity, and at most ${maxAge} hours after sign-in.`, sub: "Configured by SESSION_IDLE_MINUTES and SESSION_MAX_AGE_HOURS on the server. Sessions are stored server-side; deactivating a user or resetting their password signs them out everywhere immediately." },
        { icon: Lock, title: "Account lockout", body: "5 consecutive failed sign-ins lock the account for 15 minutes.", sub: "Lockouts are cleared by a successful sign-in after the lock expires, or by an administrator password reset." },
        { icon: Gauge, title: "Rate limits", body: "Sign-in: 30 attempts per IP and 10 per email address per 15 minutes. Password-reset requests: 10 per IP and 3 per email per hour.", sub: "Enforced in the database, so limits apply across all application instances." },
        { icon: ShieldCheck, title: "Access control", body: "Every page and API checks the user's permissions on the server. Patient portal accounts can only reach their own records.", sub: "Role permissions are edited on the Roles & permissions tab (Super Administrator only)." },
        { icon: Hash, title: "Audit trail", body: "Sign-ins, record access, exports and all administrative changes are written to an append-only audit log.", sub: "Audit metadata contains identifiers and field names only — never clinical free text." },
      ];
      return (
        <div className="p-5">
          <p className="text-[13px] text-muted mb-4">These are read-only facts about how this installation is configured. They are set in code or server environment variables, not on this screen.</p>
          <div className="grid md:grid-cols-2 gap-4">
            {facts.map((f) => (
              <div key={f.title} className="rounded-lg border border-border p-4 flex gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0"><f.icon size={18} aria-hidden /></div>
                <div className="min-w-0">
                  <p className="font-semibold text-[14px]">{f.title}</p>
                  <p className="text-[13.5px] mt-0.5">{f.body}</p>
                  <p className="text-xs text-muted mt-1">{f.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
  }
}
