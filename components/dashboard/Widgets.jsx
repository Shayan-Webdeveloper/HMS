import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Small server-renderable building blocks shared by the dashboard sections.

export function KpiGrid({ children, className }) {
  return <div className={cn("grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4", className)}>{children}</div>;
}

export function Panel({ title, description, action, children, className, bodyClassName }) {
  return (
    <section className={cn("card flex flex-col min-w-0", className)}>
      <header className="card-header">
        <div className="min-w-0">
          <h2 className="card-title">{title}</h2>
          {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
        </div>
        {action}
      </header>
      <div className={cn("flex-1 min-w-0", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children = "View all" }) {
  if (!href) return null;
  return <Link href={href} className="text-[12.5px] font-semibold text-primary hover:underline inline-flex items-center gap-0.5 shrink-0">{children}<ChevronRight size={13} aria-hidden /></Link>;
}

/** Compact list. items: [{ key, href?, title, sub?, right? }] */
export function RowList({ items, empty = "Nothing to show." }) {
  if (!items.length) return <p className="px-4 py-8 text-center text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((it) => (
        <li key={it.key} className="px-4 py-2.5 flex items-center justify-between gap-3 min-w-0">
          <div className="min-w-0">
            {it.href ? <Link href={it.href} className="text-[13.5px] font-medium hover:text-primary truncate block">{it.title}</Link> : <p className="text-[13.5px] font-medium truncate">{it.title}</p>}
            {it.sub && <p className="text-xs text-muted truncate">{it.sub}</p>}
          </div>
          {it.right && <div className="shrink-0 flex items-center gap-2 text-right">{it.right}</div>}
        </li>
      ))}
    </ul>
  );
}

/** Label / value pairs (e.g. counts by status). */
export function StatRows({ rows }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map((r) => (
        <div key={r.label} className="px-4 py-2 flex items-center justify-between gap-3">
          <dt className="text-[13px] text-muted flex items-center gap-2">{r.dot && <span className="w-2 h-2 rounded-full" style={{ background: r.dot }} aria-hidden />}{r.label}</dt>
          <dd className="text-[13.5px] font-semibold tabular">{r.href ? <Link href={r.href} className="hover:text-primary">{r.value}</Link> : r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function QuickActions({ actions }) {
  if (!actions.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 p-4">
      {actions.map((a) => (
        <Link key={a.href + a.label} href={a.href} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-[13px] font-medium hover:border-primary hover:bg-primary-soft hover:text-primary-ink transition-colors">
          {a.icon && <a.icon size={16} aria-hidden className="shrink-0" />}<span className="truncate">{a.label}</span>
        </Link>
      ))}
    </div>
  );
}

export const fmtInt = (n) => Number(n || 0).toLocaleString("en-US");
export const patientName = (p) => (p ? `${p.firstName} ${p.lastName}` : "—");
export const doctorName = (d) => (d?.staff ? `Dr. ${d.staff.firstName} ${d.staff.lastName}` : "—");
