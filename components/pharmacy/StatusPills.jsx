import Link from "next/link";
import { buildHref } from "@/components/ui/DataTable";

/** Server-rendered segmented filter (links), keeps the other query params. */
export function StatusPills({ path, params = {}, name = "status", options, active, label = "Filter" }) {
  return (
    <nav className="flex flex-wrap gap-1.5 px-3 pt-3" aria-label={label}>
      {options.map((o) => {
        const on = (active || "") === (o.value || "");
        return (
          <Link key={o.value || "default"} href={buildHref(path, params, { [name]: o.value || undefined, page: undefined })} scroll={false}
            aria-current={on ? "true" : undefined}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold border transition-colors ${on ? "bg-primary-soft text-primary-ink border-primary/30" : "bg-surface text-muted border-border hover:text-ink hover:border-border-strong"}`}>
            {o.label}
            {o.count != null && <span className={`tabular text-[11.5px] ${on ? "text-primary-ink" : "text-subtle"}`}>{o.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
