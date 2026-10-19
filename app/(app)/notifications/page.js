import Link from "next/link";
import { BellOff } from "lucide-react";
import { z } from "zod";
import { requirePageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getHospital } from "@/lib/services/settings";
import { pageMeta } from "@/lib/validation/common";
import { formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination, buildHref } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { NotificationList, MarkAllRead } from "@/components/dashboard/NotificationList";

export const metadata = { title: "Notifications" };

const CATEGORIES = ["APPOINTMENT", "LAB", "PHARMACY", "BILLING", "ADMISSION", "HR", "SYSTEM"];
const q = z.object({
  category: z.string().regex(/^[A-Z_]{2,30}$/).optional().catch(undefined),
  state: z.enum(["unread", "read"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1).catch(1),
});

// Notifications always belong to the signed-in user (userId in every WHERE clause).
export default async function NotificationsPage({ searchParams }) {
  const session = await requirePageSession();
  const sp = q.parse(await searchParams);
  const h = await getHospital();
  const pageSize = 25;
  const where = { userId: session.user.id, ...(sp.category ? { category: sp.category } : {}), ...(sp.state === "unread" ? { readAt: null } : sp.state === "read" ? { readAt: { not: null } } : {}) };
  const [total, rows, unread, byCategory] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (sp.page - 1) * pageSize, take: pageSize }),
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
    prisma.notification.groupBy({ by: ["category"], where: { userId: session.user.id }, _count: { _all: true, readAt: true } }),
  ]);
  // Known categories plus any others other modules have used for this user.
  const categories = [...new Set([...CATEGORIES, ...byCategory.map((g) => g.category)])];
  const meta = pageMeta(total, sp.page, pageSize);
  const params = { category: sp.category, state: sp.state };
  const unreadBy = Object.fromEntries(byCategory.map((g) => [g.category, g._count._all - g._count.readAt]));
  const chip = (label, overrides, active, count) => (
    <Link key={label} href={buildHref("/notifications", { ...params, ...overrides })} aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12.5px] font-semibold transition-colors ${active ? "bg-primary text-white border-primary" : "bg-surface border-border-strong text-muted hover:text-ink"}`}>
      {label}{count ? <span className={`tabular text-[11px] ${active ? "text-white/80" : "text-primary"}`}>{count}</span> : null}
    </Link>
  );

  return (
    <>
      <PageHeader title="Notifications & tasks" description={`${unread} unread. Alerts never include clinical details — open the linked record to see more.`} actions={<MarkAllRead unread={unread} />} />
      <div className="card">
        <div className="p-3 border-b border-border flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Read state">
            {chip("All", { state: undefined }, !sp.state)}
            {chip("Unread", { state: "unread" }, sp.state === "unread", unread)}
            {chip("Read", { state: "read" }, sp.state === "read")}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
            {chip("All categories", { category: undefined }, !sp.category)}
            {categories.map((c) => chip(c.charAt(0) + c.slice(1).toLowerCase(), { category: c }, sp.category === c, unreadBy[c]))}
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={BellOff} title={sp.state === "unread" ? "You're all caught up" : "No notifications"} description={sp.category || sp.state ? "Try a different filter." : "Alerts about your work will appear here."} />
        ) : (
          <NotificationList items={rows.map((n) => ({ id: n.id, category: n.category, title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAtLabel: formatDateTime(n.createdAt, h.timezone), readAtLabel: n.readAt ? formatDateTime(n.readAt, h.timezone) : null }))} />
        )}
        <Pagination path="/notifications" params={params} meta={meta} />
      </div>
    </>
  );
}
