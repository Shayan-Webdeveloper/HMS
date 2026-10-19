import { requirePortalSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { PORTAL_NAV } from "@/lib/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/utils/time";

export const metadata = { title: { default: "Patient portal", template: "%s · Patient portal" } };

// Patient portal shell. Only signed-in users with portal:access AND a verified patient link get here;
// every page and API below scopes its queries by session.patientId.
export default async function PortalLayout({ children }) {
  const session = await requirePortalSession({ allowPasswordChange: true });
  const hospital = await getHospital();
  return (
    <AppShell portal nav={PORTAL_NAV} hospital={{ name: hospital.name }}
      user={{ name: session.user.name, email: session.user.email, roleLabel: "Patient", profileHref: "/portal/profile" }}
      todayLabel={formatDate(new Date(), hospital.timezone)}>
      {children}
    </AppShell>
  );
}
