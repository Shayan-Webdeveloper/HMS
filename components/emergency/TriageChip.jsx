/** Staff-assigned triage category, coloured from the configured categories (server-safe). */
export function TriageChip({ category, categories, size = "md" }) {
  if (!category) return <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2 h-6 text-[11.5px] font-semibold text-muted">Not triaged</span>;
  const c = categories.find((x) => x.key === category) || { key: category, label: category, color: "#64748b" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 font-semibold text-ink bg-surface ${size === "lg" ? "h-7 text-[13px]" : "h-6 text-[11.5px]"}`} style={{ borderColor: c.color }}>
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} aria-hidden />
      {c.key !== c.label ? `${c.key} · ${c.label}` : c.label}
    </span>
  );
}
