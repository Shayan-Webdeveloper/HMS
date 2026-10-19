import { route } from "@/lib/api/handler";
import { getVisit, getVisitActivity } from "@/lib/services/emergency";
import { notFound } from "@/lib/errors";

export const GET = route({ permission: "emergency:read" }, async ({ params }) => {
  const v = await getVisit(params.id);
  if (!v) throw notFound();
  const activity = await getVisitActivity(v.id);
  return { ...v, activity: activity.map((a) => ({ id: a.id, action: a.action, at: a.createdAt, user: a.user?.name ?? null, metadata: a.metadata })) };
});
