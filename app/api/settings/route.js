import { route } from "@/lib/api/handler";
import { getHospital } from "@/lib/services/settings";
import { settingDefaults, getSettingMeta } from "@/lib/services/users";
import { SETTING_SCHEMAS } from "@/lib/validation/settings";
import { ID_FORMATS } from "@/lib/ids";

export const GET = route({ permission: "settings:read" }, async () => {
  const h = await getHospital();
  const editable = Object.fromEntries(Object.keys(SETTING_SCHEMAS).map((k) => [k, { ...settingDefaults(k), ...(h.settings[k] || {}) }]));
  return {
    hospital: { id: h.id, name: h.name, code: h.code, address: h.address, phone: h.phone, email: h.email, timezone: h.timezone, currency: h.currency, locale: h.locale },
    settings: editable,
    identifierFormats: ID_FORMATS, // code constants (lib/ids.js) — read-only
    meta: await getSettingMeta(),
  };
});
