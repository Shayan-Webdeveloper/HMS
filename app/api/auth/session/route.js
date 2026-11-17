import { route } from "@/lib/api/handler";

export const GET = route({ public: true }, async ({ session }) => {
  if (!session) return { authenticated: false };
  return {
    authenticated: true,
    user: session.user,
    platformRole: session.platformRole,
    hospital: session.hospital,
    hospitals: session.hospitals,
    roles: session.roles,
    permissions: [...session.permissions],
    patientId: session.patientId,
  };
});
