import { notFound } from "next/navigation";
import { requirePortalSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { portalProfile } from "@/lib/services/dashboard";
import { formatDateOnly, formatDate } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ChangePasswordForm } from "@/components/shared/ChangePasswordForm";
import { PortalProfileForm } from "@/components/portal/PortalForms";

export const metadata = { title: "Profile & security" };

export default async function PortalProfilePage() {
  const session = await requirePortalSession({ allowPasswordChange: true });
  const h = await getHospital();
  const p = await portalProfile(session.patientId);
  if (!p) notFound();
  return (
    <>
      <PageHeader title="Profile & security" description="Update how the hospital contacts you, and manage your password." />
      {session.user.mustChangePassword && (
        <div role="alert" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft text-warning px-4 py-3 text-[13.5px] font-medium">You are signed in with a temporary password. Please choose a new one below.</div>
      )}
      <div className="grid lg:grid-cols-[1fr_380px] gap-5">
        <div className="space-y-5">
          <Card title="Personal details" description="To correct your name, date of birth or sex, please contact the hospital's registration desk with ID.">
            <dl className="dl-grid">
              <div><dt>Name</dt><dd>{p.firstName} {p.lastName}</dd></div>
              <div><dt>Medical record number</dt><dd className="font-mono">{p.mrn}</dd></div>
              <div><dt>Date of birth</dt><dd>{p.dateOfBirth ? formatDateOnly(p.dateOfBirth) : "—"}</dd></div>
              <div><dt>Sex</dt><dd>{p.sex === "UNKNOWN" ? "Not recorded" : p.sex.charAt(0) + p.sex.slice(1).toLowerCase()}</dd></div>
              <div><dt>Registered</dt><dd>{formatDate(p.registeredAt, h.timezone)}</dd></div>
              <div><dt>Sign-in email</dt><dd>{session.user.email}</dd></div>
            </dl>
          </Card>
          <Card title="Contact details & preferences"><PortalProfileForm profile={{ phone: p.phone, email: p.email, address: p.address, city: p.city, consentToSms: p.consentToSms, consentToEmail: p.consentToEmail }} /></Card>
        </div>
        <div id="password">
          <Card title="Change password" description="Changing your password signs you out on other devices."><ChangePasswordForm /></Card>
        </div>
      </div>
    </>
  );
}
