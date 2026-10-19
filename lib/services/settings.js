import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";

export const SETTING_DEFAULTS = {
  "hospital.profile": { name: "Demo General Hospital", address: "", phone: "", email: "", logoText: "DGH" },
  "locale": { timezone: "Asia/Karachi", currency: "PKR", locale: "en-PK", dateFormat: "dd MMM yyyy" },
  "appointments": { workdayStart: "09:00", workdayEnd: "17:00", defaultSlotMinutes: 15, allowPatientRequests: true, minCancelHours: 4 },
  "billing": { taxRatePercent: "0", paymentMethods: ["CASH", "CARD", "BANK_TRANSFER"], maxDiscountPercentWithoutApproval: 10 },
  "pharmacy": { expiryAlertDays: 90 },
  "lab": { requireSecondValidator: false },
  "services.catalog": { items: [] },
  "emergency": { triageCategories: [
    { key: "RED", label: "Immediate", color: "#dc2626" },
    { key: "ORANGE", label: "Very urgent", color: "#ea580c" },
    { key: "YELLOW", label: "Urgent", color: "#ca8a04" },
    { key: "GREEN", label: "Standard", color: "#16a34a" },
    { key: "BLUE", label: "Non-urgent", color: "#2563eb" },
  ] },
};

export const getHospital = cache(async () => {
  const h = await prisma.hospital.findFirst({ orderBy: { createdAt: "asc" }, include: { settings: true } });
  if (!h) return { id: null, name: "Hospital (not configured)", timezone: "Asia/Karachi", currency: "PKR", locale: "en-PK", settings: { ...SETTING_DEFAULTS } };
  const settings = { ...SETTING_DEFAULTS };
  for (const s of h.settings) settings[s.key] = { ...(SETTING_DEFAULTS[s.key] || {}), ...s.value };
  return { id: h.id, name: h.name, code: h.code, address: h.address, phone: h.phone, email: h.email, timezone: h.timezone, currency: h.currency, locale: h.locale, settings };
});

export async function getSetting(key) {
  const h = await getHospital();
  return h.settings[key] ?? SETTING_DEFAULTS[key];
}
