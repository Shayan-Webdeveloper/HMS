import { route } from "@/lib/api/handler";
import { listQuery } from "@/lib/validation/common";
import { listPatients } from "@/lib/services/patients";
import { getHospital } from "@/lib/services/settings";
import { toCsv, MAX_EXPORT_ROWS } from "@/lib/utils/csv";
import { audit } from "@/lib/audit";
import { formatDateOnly } from "@/lib/utils/time";

export const GET = route({ permission: "patients:export" }, async ({ query, session, ip }) => {
  const q = query(listQuery.omit({ pageSize: true, page: true }));
  const h = await getHospital();
  const { rows, meta } = await listPatients({ ...q, page: 1, pageSize: MAX_EXPORT_ROWS }, h.timezone);
  await audit({ userId: session.user.id, action: "patient.export", entityType: "Patient", metadata: { rows: rows.length, filters: { q: q.q, status: q.status } }, ipAddress: ip });
  const csv = toCsv([
    { label: "MRN", key: "mrn" }, { label: "First name", key: "firstName" }, { label: "Last name", key: "lastName" },
    { label: "Sex", key: "sex" }, { label: "Date of birth", value: (r) => (r.dateOfBirth ? formatDateOnly(r.dateOfBirth) : "") },
    { label: "Phone", key: "phone" }, { label: "City", key: "city" }, { label: "Status", key: "status" },
    { label: "Registered", value: (r) => r.registeredAt.toISOString() },
  ], rows);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="patients-${new Date().toISOString().slice(0, 10)}.csv"`, "X-Total-Rows": String(meta.total), "Cache-Control": "no-store" } });
});
