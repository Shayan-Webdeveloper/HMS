import { cn } from "@/lib/utils/cn";

export function Card({ title, description, actions, children, className, bodyClassName, noPadding }) {
  return (
    <section className={cn("card", className)}>
      {(title || actions) && (
        <header className="card-header">
          <div className="min-w-0">
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(!noPadding && "card-body", bodyClassName)}>{children}</div>
    </section>
  );
}
