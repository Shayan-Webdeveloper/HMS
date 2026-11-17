import { route, ok } from "@/lib/api/handler";
import { uploadDocument } from "@/lib/services/documents";

// Upload a patient document. Authorisation is per category (documents.<group>:upload) — checked in the
// service together with the patient belonging to the caller's hospital. The route-level list only
// screens out roles that cannot upload anything.
const ANY_UPLOAD = ["clinical", "lab", "imaging", "insurance", "identity", "consent", "other"].map((g) => `documents.${g}:upload`);

export const POST = route({ permission: ANY_UPLOAD }, async ({ req, session, ip }) => {
  let form;
  try { form = await req.formData(); } catch { form = null; }
  const doc = await uploadDocument({
    file: form?.get("file"),
    patientId: String(form?.get("patientId") || ""),
    category: String(form?.get("category") || "OTHER"),
  }, session, ip);
  return ok(doc, undefined, { status: 201 });
});
