import { requirePlatformSession, PLATFORM_ROLE_LABELS } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/utils/time";

export const metadata = { title: { default: "Platform administration", template: "%s · Platform" } };

const NAV = [{ href: "/platform", label: "Hospitals", icon: "Building2" }];

// Platform console shell. Platform Administrators manage hospital tenants only; this area has no
// hospital context, so no hospital data can be loaded here.
export default async function PlatformLayout({ children }) {
  const session = await requirePlatformSession({ allowPasswordChange: true });
  return (
    <AppShell platform nav={NAV} hospital={{ id: null, name: "HMS Platform" }}
      user={{ name: session.user.name, email: session.user.email, roleLabel: PLATFORM_ROLE_LABELS[session.platformRole], profileHref: "/platform" }}
      todayLabel={formatDate(new Date(), "UTC")}>
      {children}
    </AppShell>
  );
}
