import { route, ok } from "@/lib/api/handler";
import { imagingListQuery, imagingRequestSchema } from "@/lib/validation/radiology";
import { listImagingStudies, createImagingStudy } from "@/lib/services/radiology";
import { getHospital } from "@/lib/services/settings";

export const GET = route({ permission: "radiology:read" }, async ({ query }) => {
  const q = query(imagingListQuery);
  const h = await getHospital();
  const { rows, meta } = await listImagingStudies(q, h.timezone);
  return ok(rows.map((r) => ({
    id: r.id, studyNo: r.studyNo, status: r.status, modality: r.modality, bodyPart: r.bodyPart, scheduledAt: r.scheduledAt, createdAt: r.createdAt,
    patient: r.patient, requestedByName: r.requestedByName,
  })), meta);
});

// Contract: { patientId, encounterId?, catalogCode, indication? }.
export const POST = route({ permission: "radiology:order" }, async ({ body, session, ip }) => {
  const input = await body(imagingRequestSchema);
  return ok(await createImagingStudy(input, session, ip), undefined, { status: 201 });
});
