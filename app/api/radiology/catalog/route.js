import { route } from "@/lib/api/handler";
import { imagingCatalogSchema } from "@/lib/validation/radiology";
import { getImagingCatalog, saveImagingCatalog } from "@/lib/services/radiology";

// Contract: [{ code, modality, bodyPart, price }] from SystemSetting "imaging.catalog".
export const GET = route({ permission: ["radiology:order", "radiology:read"] }, async () => getImagingCatalog());

export const PUT = route({ permission: ["radiology:verify", "settings:manage"] }, async ({ body, session, ip }) => {
  const input = await body(imagingCatalogSchema);
  return saveImagingCatalog(input, session, ip);
});
