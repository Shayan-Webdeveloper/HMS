import { route, ok } from "@/lib/api/handler";
import { doctorListQuery, doctorSchema } from "@/lib/validation/staff";
import { listDoctors, toDoctorOption, createDoctor } from "@/lib/services/staff";

// Contract (CONVENTIONS.md): [{ id (DoctorProfile.id), name, specialty, departmentId, departmentName, consultationFee, slotMinutes }]
// Default scope "bookable" = staff employmentStatus ACTIVE and acceptsAppointments. `scope=all` lists every doctor.
export const GET = route({ permission: ["staff:read", "appointments:read", "appointments:create"] }, async ({ query }) => {
  const q = query(doctorListQuery);
  const bookable = q.scope !== "all";
  const { rows, meta } = await listDoctors({
    q: q.q, page: q.page, pageSize: q.pageSize, sort: q.sort || "name", dir: q.sort ? q.dir : "asc",
    departmentId: q.departmentId,
    status: bookable ? "ACTIVE" : q.status,
    accepting: bookable ? "yes" : q.accepting,
  });
  return ok(rows.map(toDoctorOption), meta);
});

export const POST = route({ permission: "staff:manage" }, async ({ body, session, ip }) => {
  const input = await body(doctorSchema);
  const r = await createDoctor(input, session, ip);
  // May carry a one-time temporary password — never cache.
  return ok(r, undefined, { status: 201, headers: { "Cache-Control": "no-store" } });
});
