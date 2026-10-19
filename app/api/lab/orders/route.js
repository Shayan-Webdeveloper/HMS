import { route, ok } from "@/lib/api/handler";
import { labListQuery, labOrderSchema } from "@/lib/validation/lab";
import { listLabOrders, createLabOrder } from "@/lib/services/lab";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "lab:read" }, async ({ query, session }) => {
  const q = query(labListQuery);
  const h = await getHospital();
  const { rows, meta } = await listLabOrders(q, h.timezone, session);
  return ok(rows.map((r) => ({
    id: r.id, orderNo: r.orderNo, status: r.status, priority: r.priority, createdAt: r.createdAt, releasedAt: r.releasedAt,
    patient: r.patient,
    doctorName: r.doctor ? `${r.doctor.staff.firstName} ${r.doctor.staff.lastName}` : null,
    tests: r.items.map((i) => ({ code: i.test.code, name: i.test.name })),
  })), meta);
});

// Contract: { patientId, encounterId?, testIds:[], priority: ROUTINE|URGENT|STAT, clinicalNotes? }; doctor = session.doctorId.
export const POST = route({ permission: "lab:order" }, async ({ body, session, ip }) => {
  const input = await body(labOrderSchema);
  return ok(await createLabOrder(input, session, ip), undefined, { status: 201 });
});
