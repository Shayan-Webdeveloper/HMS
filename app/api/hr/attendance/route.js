import { route } from "@/lib/api/handler";
import { attendanceQuery, attendanceSchema } from "@/lib/validation/staff";
import { getAttendanceSheet, saveAttendance } from "@/lib/services/hr";
import { getHospital } from "@/lib/services/settings";
import { todayInTz } from "@/lib/utils/time";

export const GET = route({ permission: "hr:read" }, async ({ query }) => {
  const q = query(attendanceQuery);
  const h = await getHospital();
  return getAttendanceSheet(q.date || todayInTz(h.timezone), { departmentId: q.departmentId, q: q.q });
});

/** Bulk save: upsert on @@unique([staffId, date]). */
export const PUT = route({ permission: "hr:manage" }, async ({ body, session, ip }) => {
  const input = await body(attendanceSchema);
  const h = await getHospital();
  return saveAttendance(input, h.timezone, session, ip);
});
