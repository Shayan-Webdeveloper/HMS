import { route } from "@/lib/api/handler";
import { slotsQuery } from "@/lib/validation/appointments";
import { getSlots } from "@/lib/services/appointments";

// Contract: { slots: [{ start: "HH:MM", startsAt: ISO, available: bool }] } (+ endsAt, reason, message, slotMinutes).
export const GET = route({ permission: ["appointments:read", "appointments:create"] }, async ({ query }) => {
  const q = query(slotsQuery);
  return getSlots(q);
});
