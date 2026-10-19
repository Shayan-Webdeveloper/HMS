import { route } from "@/lib/api/handler";
import { auditQuerySchema } from "@/lib/validation/settings";
import { listAuditLogs } from "@/lib/services/users";
import { getHospital } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { toCsv, MAX_EXPORT_ROWS } from "@/lib/utils/csv";
import { toZonedDateString, toZonedTimeString } from "@/lib/utils/time";

// CSV export of the filtered audit trail (formula-injection safe, capped at MAX_EXPORT_ROWS). The export itself is audited.
export const GET = route({ permission: "audit:read" }, async ({ query, session, ip }) => {
  const f = query(auditQuerySchema.omit({ page: true, pageSize: true }));
  const h = await getHospital();
  const { rows, meta } = await listAuditLogs({ ...f, page: 1, pageSize: MAX_EXPORT_ROWS }, h.timezone);
  const filters = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  await audit({ userId: session.user.id, action: "audit.export", entityType: "AuditLog", metadata: { filters, rows: rows.length, total: meta.total }, ipAddress: ip });
  const tz = h.timezone;
  const csv = toCsv([
    { label: `Time (${tz})`, value: (r) => `${toZonedDateString(r.createdAt, tz)} ${toZonedTimeString(r.createdAt, tz)}` },
    { label: "Time (UTC ISO)", value: (r) => r.createdAt.toISOString() },
    { label: "User", value: (r) => r.user?.name ?? "System" },
    { label: "User email", value: (r) => r.user?.email ?? "" },
    { label: "Action", key: "action" },
    { label: "Entity type", key: "entityType" },
    { label: "Entity ID", key: "entityId" },
    { label: "Metadata (JSON)", value: (r) => (r.metadata == null ? "" : JSON.stringify(r.metadata)) },
    { label: "IP address", key: "ipAddress" },
  ], rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${toZonedDateString(new Date(), tz)}.csv"`,
      "X-Total-Rows": String(meta.total),
      "Cache-Control": "no-store",
    },
  });
});
