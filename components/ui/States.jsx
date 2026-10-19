import { Inbox, AlertTriangle, ShieldOff } from "lucide-react";

export function EmptyState({ icon: Icon = Inbox, title = "Nothing here yet", description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-11 h-11 rounded-full bg-neutral-soft flex items-center justify-center mb-3">
        <Icon size={20} className="text-muted" aria-hidden />
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="text-[13px] text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description = "Please try again. If the problem continues, contact support.", action }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-11 h-11 rounded-full bg-danger-soft flex items-center justify-center mb-3">
        <AlertTriangle size={20} className="text-danger" aria-hidden />
      </div>
      <p className="font-semibold">{title}</p>
      <p className="text-[13px] text-muted mt-1 max-w-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ForbiddenState() {
  return <EmptyState icon={ShieldOff} title="Access restricted" description="Your role does not include permission to view this page. Contact an administrator if you believe this is a mistake." />;
}

export function Skeleton({ className = "h-4 w-full" }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function TableSkeleton({ rows = 8, cols = 5 }) {
  return (
    <div className="p-4 space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} className="h-4" />)}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading page">
      <Skeleton className="h-7 w-64" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
      <div className="card"><TableSkeleton /></div>
    </div>
  );
}
