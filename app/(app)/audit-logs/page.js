import { requirePageSession, can } from "@/lib/auth/session";
import { getHospital } from "@/lib/services/settings";
import { listAuditLogs, auditEntityTypes } from "@/lib/services/users";
import { auditQuerySchema } from "@/lib/validation/settings";
import { formatDateTime } from "@/lib/utils/time";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { AuditFilters } from "@/components/settings/AuditFilters";

export const metadata = { title: "Audit logs" };

function compactJson(v) {
  if (v == null) return "";
  const s = JSON.stringify(v);
  return s.length > 220 ? `${s.slice(0, 217)}…` : s;
}

export default async function AuditLogsPage({ searchParams }) {
  const session = await requirePageSession("audit:read");
  const raw = await searchParams;
  const parsed = auditQuerySchema.safeParse(raw);
  const h = await getHospital();
  const types = await auditEntityTypes();
  const exportHref = can(session, "audit:read") ? "/api/audit/export" : null;

  if (!parsed.success) {
    return (
      <>
        <PageHeader title="Audit logs" description="Append-only record of sign-ins, record access and changes." />
        <div className="card"><AuditFilters entityTypes={types} /><ErrorState title="Invalid filter" description={parsed.error.issues[0]?.message || "Check the filter values."} /></div>
      </>
    );
  }
  const f = parsed.data;
  const { rows, meta } = await listAuditLogs(f, h.timezone);
  const params = { user: f.user, action: f.action, entityType: f.entityType, entityId: f.entityId, from: f.from, to: f.to };

  return (
    <>
      <PageHeader title="Audit logs" description={`Append-only record of sign-ins, record access and changes. Times in ${h.timezone}. Metadata holds identifiers and field names only — never clinical text.`} />
      <div className="card">
        <AuditFilters entityTypes={types} exportHref={exportHref} />
        <DataTable rows={rows} caption="Audit log entries"
          empty={<EmptyState title="No audit entries match" description="Widen the date range or clear filters." />}
          columns={[
            { key: "createdAt", label: "When", render: (r) => <span className="whitespace-nowrap tabular text-[13px]">{formatDateTime(r.createdAt, h.timezone, { second: "2-digit" })}</span> },
            { key: "user", label: "User", render: (r) => (r.user ? <span><span className="font-medium">{r.user.name}</span><br className="hidden sm:inline" /><span className="text-xs text-muted sm:block">{r.user.email}</span></span> : <span className="text-muted">System</span>) },
            { key: "action", label: "Action", render: (r) => <code className="text-[12px] font-semibold">{r.action}</code> },
            { key: "entity", label: "Entity", render: (r) => <span className="text-[13px]">{r.entityType}{r.entityId && <span className="block font-mono text-[11px] text-subtle break-all">{r.entityId}</span>}</span> },
            { key: "metadata", label: "Metadata", className: "max-w-[340px]", render: (r) => (r.metadata ? <code className="text-[11.5px] text-muted break-all" title={JSON.stringify(r.metadata)}>{compactJson(r.metadata)}</code> : <span className="text-subtle">—</span>) },
            { key: "ip", label: "IP", render: (r) => <span className="font-mono text-[11.5px] text-muted">{r.ipAddress || "—"}</span> },
          ]} />
        <Pagination path="/audit-logs" params={params} meta={meta} />
      </div>
    </>
  );
}
