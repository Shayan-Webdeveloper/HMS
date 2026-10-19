import { requirePageSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ChangePasswordForm } from "@/components/shared/ChangePasswordForm";
import { ROLES } from "@/lib/permissions/matrix";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }) {
  const s = await requirePageSession();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Account & security" description="Your profile and password." />
      {(sp?.first === "1" || s.user.mustChangePassword) && (
        <div role="alert" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft text-warning px-4 py-3 text-[13.5px] font-medium">Please set a new password before continuing — your account was created with a temporary one.</div>
      )}
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Profile">
          <dl className="dl-grid">
            <div><dt>Name</dt><dd>{s.user.name}</dd></div>
            <div><dt>Email</dt><dd>{s.user.email}</dd></div>
            <div><dt>Roles</dt><dd>{s.roles.map((r) => ROLES[r]?.name || r).join(", ")}</dd></div>
            <div><dt>Department</dt><dd>{s.staff?.departmentName || "—"}</dd></div>
          </dl>
        </Card>
        <Card title="Change password" description="Changing your password signs out your other sessions."><ChangePasswordForm /></Card>
      </div>
    </>
  );
}
