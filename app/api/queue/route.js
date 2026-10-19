import { z } from "zod";
import { route } from "@/lib/api/handler";
import { optionalDate } from "@/lib/validation/common";
import { listQueue } from "@/lib/services/encounters";
import { getHospital } from "@/lib/services/settings";
import { todayInTz } from "@/lib/utils/time";

const q = z.object({
  date: optionalDate,
  doctorId: z.string().max(64).optional(),
  includeDone: z.enum(["0", "1", "true", "false"]).optional(),
});

export const GET = route({ permission: "appointments:read" }, async ({ query }) => {
  const p = query(q);
  const h = await getHospital();
  const rows = await listQueue({ date: p.date || todayInTz(h.timezone), doctorId: p.doctorId || undefined, includeDone: p.includeDone === "1" || p.includeDone === "true" });
  // Minimal, non-clinical projection for the queue board.
  return rows.map((r) => ({
    id: r.id, tokenNumber: r.tokenNumber, status: r.status, queueDate: r.queueDate, vitalsRecorded: r.vitalsRecorded,
    appointment: {
      id: r.appointment.id, appointmentNo: r.appointment.appointmentNo, startsAt: r.appointment.startsAt, checkedInAt: r.appointment.checkedInAt,
      type: r.appointment.type, status: r.appointment.status, encounterId: r.appointment.encounter?.id ?? null,
      patient: { id: r.appointment.patient.id, mrn: r.appointment.patient.mrn, name: `${r.appointment.patient.firstName} ${r.appointment.patient.lastName}` },
      doctor: { id: r.appointment.doctor.id, name: `${r.appointment.doctor.staff.firstName} ${r.appointment.doctor.staff.lastName}` },
    },
  }));
});
