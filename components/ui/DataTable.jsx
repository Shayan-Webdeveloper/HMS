import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "./States";

export function buildHref(path, params = {}, overrides = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...overrides })) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Server-rendered data table. Sorting & paging are links (server-side), so they work
 * without JavaScript and are bookmarkable.
 * columns: [{ key, label, sortable?, render?(row), align?: "right", className? }]
 */
export function DataTable({ columns, rows, path, params = {}, sort, dir = "desc", empty, rowKey = (r) => r.id, caption }) {
  if (!rows.length) return empty ?? <EmptyState title="No records found" description="Try adjusting your search or filters." />;
  return (
    <div className="table-wrap">
      <table className="table table-responsive">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort === c.key;
              const nextDir = active && dir === "asc" ? "desc" : "asc";
              const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th key={c.key} scope="col" className={c.align === "right" ? "num" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sortable && path ? (
                    <Link href={buildHref(path, params, { sort: c.key, dir: nextDir, page: 1 })} className="inline-flex items-center gap-1 hover:text-ink">
                      {c.label}<Icon size={12} aria-hidden className={active ? "" : "opacity-40"} />
                    </Link>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={[c.align === "right" ? "num" : "", c.className || ""].join(" ")}>
                  {c.render ? c.render(r) : r[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ path, params = {}, meta }) {
  if (!meta || meta.total === 0) return null;
  const { page, pageCount, total, pageSize } = meta;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-[13px]" aria-label="Pagination">
      <p className="text-muted">Showing <span className="font-semibold text-ink tabular">{from}–{to}</span> of <span className="font-semibold text-ink tabular">{total}</span></p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link className="btn btn-secondary btn-sm" href={buildHref(path, params, { page: page - 1 })} aria-label="Previous page"><ChevronLeft size={14} /> Prev</Link>
        ) : <span className="btn btn-secondary btn-sm" aria-disabled="true"><ChevronLeft size={14} /> Prev</span>}
        <span className="px-2 text-muted tabular">Page {page} / {pageCount}</span>
        {page < pageCount ? (
          <Link className="btn btn-secondary btn-sm" href={buildHref(path, params, { page: page + 1 })} aria-label="Next page">Next <ChevronRight size={14} /></Link>
        ) : <span className="btn btn-secondary btn-sm" aria-disabled="true">Next <ChevronRight size={14} /></span>}
      </div>
    </nav>
  );
}
