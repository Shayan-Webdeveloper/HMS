import Link from "next/link";

/** URL-driven tabs (server-friendly, shareable, back-button aware). */
export function LinkTabs({ tabs, active, baseHref, param = "tab" }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map((t) => {
        const href = `${baseHref}${baseHref.includes("?") ? "&" : "?"}${param}=${t.key}`;
        return (
          <Link key={t.key} href={href} className="tab" aria-selected={active === t.key} role="tab" scroll={false}>
            {t.label}{t.count != null && <span className="ml-1.5 text-xs text-subtle tabular">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
