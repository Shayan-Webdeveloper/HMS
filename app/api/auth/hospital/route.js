import { z } from "zod";
import { route } from "@/lib/api/handler";
import { systemPrisma } from "@/lib/db/prisma";
import { activeMemberships, loadHospitalAccess } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";

const schema = z.object({ hospitalId: z.string().min(1).max(64) });

// Switch the current session to another hospital. Allowed only for hospitals where the user has an
// ACTIVE membership in an ACTIVE hospital — verified here on the server and again on every request.
// An unknown or unauthorised id gets the same 404, so this cannot be used to probe other hospitals.
export const POST = route({ public: true }, async ({ body, session, ip }) => {
  if (!session) throw notFound();
  const { hospitalId } = await body(schema);
  const hospitals = await activeMemberships(session.user.id);
  const target = hospitals.find((h) => h.id === hospitalId);
  if (!target) throw notFound("Hospital not found");
  await systemPrisma.session.update({ where: { id: session.sessionId }, data: { activeHospitalId: target.id } });
  await audit({ userId: session.user.id, action: "auth.switch_hospital", entityType: "Hospital", entityId: target.id, metadata: { from: session.hospitalId }, ipAddress: ip, hospitalId: target.id });
  const access = await loadHospitalAccess(session.user.id, target.id);
  const isPatient = access.roles.length === 1 && access.roles[0] === "PATIENT";
  return { hospital: target, redirect: isPatient ? "/portal" : "/dashboard" };
});
