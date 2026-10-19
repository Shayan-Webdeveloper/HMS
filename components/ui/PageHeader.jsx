export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="text-[13.5px] text-muted mt-1">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
