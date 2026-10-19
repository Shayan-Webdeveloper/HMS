import { route } from "@/lib/api/handler";
import { providerSchema, providerActiveSchema } from "@/lib/validation/insurance";
import { updateProvider, setProviderActive } from "@/lib/services/insurance";

export const PATCH = route({ permission: "insurance:manage" }, async ({ params, body, session, ip }) => {
  const raw = await body();
  // { isActive } alone toggles activation; otherwise a full edit.
  if (raw && Object.keys(raw).length === 1 && "isActive" in raw) {
    const { isActive } = providerActiveSchema.parse(raw);
    return setProviderActive(params.id, isActive, session, ip);
  }
  return updateProvider(params.id, providerSchema.parse(raw), session, ip);
});
