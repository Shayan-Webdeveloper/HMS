import { route } from "@/lib/api/handler";
import { notFound } from "@/lib/errors";
import { hospitalSettingsSchema, SETTING_SCHEMAS } from "@/lib/validation/settings";
import { updateHospitalProfile, updateSetting } from "@/lib/services/users";

// PUT /api/settings/hospital → Hospital row; PUT /api/settings/<appointments|billing|pharmacy|lab|emergency> → SystemSetting.
export const PUT = route({ permission: "settings:manage" }, async ({ params, body, session, ip }) => {
  if (params.key === "hospital") return updateHospitalProfile(await body(hospitalSettingsSchema), session, ip);
  const schema = SETTING_SCHEMAS[params.key];
  if (!schema) throw notFound("Unknown setting");
  return updateSetting(params.key, await body(schema), session, ip);
});
