import Link from "next/link";
import { buildHref } from "@/components/ui/DataTable";

/**
 * URL-driven status tabs that preserve the other list filters (search, priority, dates)
 * and reset paging. Server-renderable.
 */
export function StatusTabs({ tabs, active, path, params = {}, param = "status", label = "Filter by status" }) {
  return (
    <nav className="tabs px-2" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.key} href={buildHref(path, { ...params, [param]: t.key, page: undefined, sort: undefined, dir: undefined })}
          className="tab inline-flex items-center gap-1.5" role="tab" aria-selected={active === t.key} scroll={false}>
          {t.label}
          {t.count != null && (
            <span className={`tabular text-[11px] font-semibold rounded-full px-1.5 min-w-[20px] text-center ${active === t.key ? "bg-primary-soft text-primary-ink" : "bg-neutral-soft text-muted"}`}>{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
