import Link from "next/link";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/** trend: { current, previous } — percentage change is computed, never invented. */
export function MetricCard({ label, value, icon: Icon, tone = "primary", hint, trend, href }) {
  let trendEl = null;
  if (trend && trend.previous != null) {
    const prev = Number(trend.previous), cur = Number(trend.current);
    const pct = prev === 0 ? (cur === 0 ? 0 : null) : ((cur - prev) / prev) * 100;
    const up = cur > prev, flat = cur === prev;
    const TIcon = flat ? Minus : up ? TrendingUp : TrendingDown;
    trendEl = (
      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${flat ? "text-muted" : up ? "text-success" : "text-danger"}`}>
        <TIcon size={13} aria-hidden />
        {pct == null ? "new" : `${Math.abs(pct).toFixed(0)}%`}
        <span className="font-normal text-subtle">vs prev. period</span>
      </span>
    );
  }
  const toneBg = { primary: "bg-primary-soft text-primary", teal: "bg-secondary-soft text-secondary", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", success: "bg-success-soft text-success", info: "bg-info-soft text-info" }[tone];
  const body = (
    <div className="card p-4 h-full transition-shadow hover:shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-muted">{label}</p>
          <p className="text-[26px] font-bold tracking-tight mt-1 tabular">{value}</p>
        </div>
        {Icon && <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${toneBg}`}><Icon size={18} aria-hidden /></div>}
      </div>
      <div className="mt-2 min-h-[18px] flex items-center gap-2 flex-wrap">
        {trendEl}
        {hint && <span className="text-xs text-subtle">{hint}</span>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block focus-visible:rounded-xl">{body}</Link> : body;
}
