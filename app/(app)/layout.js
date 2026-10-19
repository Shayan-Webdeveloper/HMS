import { requirePageSession } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { filterNav } from "@/lib/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { ROLES } from "@/lib/permissions/matrix";
import { formatDate } from "@/lib/utils/time";

export default async function AppLayout({ children }) {
  const session = await requirePageSession();
  const hospital = await getHospital();
  const nav = filterNav([...session.permissions]);
  const roleLabel = session.roles.map((r) => ROLES[r]?.name || r).join(", ");
  return (
    <AppShell
      nav={nav}
      hospital={{ name: hospital.name }}
      user={{ name: session.user.name, email: session.user.email, roleLabel, profileHref: "/account" }}
      todayLabel={formatDate(new Date(), hospital.timezone)}
    >
      {children}
    </AppShell>
  );
}
