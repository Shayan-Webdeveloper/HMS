import { z } from "zod";
import { route } from "@/lib/api/handler";
import { forbidden } from "@/lib/errors";
import { getHospital } from "@/lib/services/settings";
import { availableViews, defaultView, buildContext, loadOverview, loadDoctor, loadReception, loadNursing, loadLaboratory, loadRadiology, loadPharmacy, loadBilling } from "@/lib/services/dashboard";

const q = z.object({
  view: z.string().max(20).optional(),
  range: z.string().max(10).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

const LOADERS = {
  overview: (s, c) => loadOverview(s, c),
  doctor: (s, c) => loadDoctor(s.doctorId, c),
  reception: (s, c) => loadReception(c),
  nursing: (s, c) => loadNursing(s, c),
  laboratory: (s, c) => loadLaboratory(c),
  radiology: (s, c) => loadRadiology(c),
  pharmacy: (s, c) => loadPharmacy(c),
  billing: (s, c) => loadBilling(c),
};

// JSON version of the dashboard: same loaders and the same per-view permission rules as the page.
export const GET = route({ permission: "dashboard:read" }, async ({ session, query }) => {
  const p = query(q);
  const views = availableViews(session);
  const view = p.view ?? defaultView(session, views);
  if (!view || !views.some((v) => v.key === view)) throw forbidden("This dashboard view is not available for your role.");
  const ctx = buildContext(await getHospital(), p);
  const data = await LOADERS[view](session, ctx);
  return { view, views, period: ctx.period, data };
});
