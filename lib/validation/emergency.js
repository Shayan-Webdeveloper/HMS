import { z } from "zod";
import { id, requiredText, optionalText, optionalDate, phone } from "./common.js";

// ───────────────────────────── Emergency department ─────────────────────────────

export const ER_STATUSES = ["WAITING_TRIAGE", "TRIAGED", "UNDER_TREATMENT", "ADMITTED", "TRANSFERRED", "DISCHARGED", "LEFT_WITHOUT_BEING_SEEN"];
export const ER_ACTIVE_STATUSES = ["WAITING_TRIAGE", "TRIAGED", "UNDER_TREATMENT"];
export const ER_DISPOSITIONS = ["DISCHARGED", "ADMITTED", "TRANSFERRED", "LEFT_WITHOUT_BEING_SEEN"];
export const ARRIVAL_MODES = ["WALK_IN", "AMBULANCE", "REFERRED"];

/**
 * Explicit ER status transition map. Triage priority is always chosen by staff;
 * nothing here computes or suggests a category.
 */
export const ER_TRANSITIONS = {
  WAITING_TRIAGE: ["TRIAGED", "LEFT_WITHOUT_BEING_SEEN"],
  TRIAGED: ["UNDER_TREATMENT", "TRANSFERRED", "LEFT_WITHOUT_BEING_SEEN"],
  UNDER_TREATMENT: ["DISCHARGED", "ADMITTED", "TRANSFERRED"],
  ADMITTED: [],
  TRANSFERRED: [],
  DISCHARGED: [],
  LEFT_WITHOUT_BEING_SEEN: [],
};

export function canErTransition(from, to) {
  return (ER_TRANSITIONS[from] || []).includes(to);
}
export const isErActive = (status) => ER_ACTIVE_STATUSES.includes(status);
/** Re-triage (changing the category) is allowed while the patient is still in the department. */
export const canTriage = (status) => ["WAITING_TRIAGE", "TRIAGED", "UNDER_TREATMENT"].includes(status);
/** Dispositions available from the given status. */
export const dispositionsFrom = (status) => ER_DISPOSITIONS.filter((d) => canErTransition(status, d));

export const erLabel = (s) => String(s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Whole minutes elapsed since `date` (relative to `now`). */
export function minutesSince(date, now = Date.now()) {
  return Math.max(0, (now - new Date(date).getTime()) / 60000);
}

/** Minutes → "2 h 05 m" / "35 m". */
export function formatWait(minutes) {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

const quickPatient = z.object({
  firstName: requiredText(80, "First name"),
  lastName: requiredText(80, "Last name"),
  sex: z.enum(["MALE", "FEMALE", "OTHER", "UNKNOWN"]).default("UNKNOWN"),
  dateOfBirth: optionalDate.refine((v) => !v || new Date(v) <= new Date(), "Date of birth cannot be in the future"),
  phone,
});

// The unused branch (existing vs. new patient) is dropped before validation so
// half-filled hidden fields never block the form.
export const erRegisterSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== "object") return v;
    if (v.patientMode === "EXISTING") return { ...v, newPatient: undefined };
    if (v.patientMode === "NEW") return { ...v, patientId: undefined };
    return v;
  },
  z.object({
    patientMode: z.enum(["EXISTING", "NEW"]),
    patientId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
    newPatient: quickPatient.optional(),
    arrivalMode: z.enum(ARRIVAL_MODES, { error: "Choose the arrival mode" }),
    presentingComplaint: requiredText(500, "Presenting complaint"),
    initialObservations: optionalText(2000),
  })
    .refine((v) => v.patientMode !== "EXISTING" || v.patientId, { path: ["patientId"], message: "Select the patient" })
    .refine((v) => v.patientMode !== "NEW" || v.newPatient, { path: ["newPatient.firstName"], message: "Enter the patient's name" }),
);

export const triageSchema = z.object({
  triageCategory: z.string({ error: "Choose a triage category" }).trim().min(1, "Choose a triage category").max(30),
  initialObservations: optionalText(2000),
});

export const assignSchema = z.object({
  clinicianId: z.string({ error: "Choose a clinician" }).min(1, "Choose a clinician").max(64),
});

export const startTreatmentSchema = z.object({
  clinicianId: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(64).optional()),
});

export const dispositionSchema = z.object({
  disposition: z.enum(ER_DISPOSITIONS, { error: "Choose a disposition" }),
  destination: optionalText(200),
  notes: optionalText(2000),
}).refine((v) => v.disposition !== "TRANSFERRED" || v.destination, { path: ["destination"], message: "Enter the destination facility" });

/** Human-readable text stored in EmergencyVisit.disposition. */
export function dispositionText({ destination, notes }) {
  return [destination ? `Destination: ${destination}` : null, notes || null].filter(Boolean).join("\n") || null;
}

// ───────────────────────────── Ambulances ─────────────────────────────

export const AMBULANCE_TYPES = ["BLS", "ALS"];
export const AMBULANCE_STATUSES = ["AVAILABLE", "DISPATCHED", "MAINTENANCE"];
export const DISPATCH_STATUSES = ["DISPATCHED", "ON_SCENE", "TRANSPORTING", "COMPLETED", "CANCELLED"];

/** Manual fleet status changes. DISPATCHED is only entered/left through dispatch workflows. */
export const AMBULANCE_MANUAL_TRANSITIONS = {
  AVAILABLE: ["MAINTENANCE"],
  MAINTENANCE: ["AVAILABLE"],
  DISPATCHED: [],
};
export const canChangeAmbulanceStatus = (from, to) => (AMBULANCE_MANUAL_TRANSITIONS[from] || []).includes(to);

export const DISPATCH_TRANSITIONS = {
  DISPATCHED: ["ON_SCENE", "CANCELLED"],
  ON_SCENE: ["TRANSPORTING", "COMPLETED", "CANCELLED"],
  TRANSPORTING: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};
export const canDispatchTransition = (from, to) => (DISPATCH_TRANSITIONS[from] || []).includes(to);
export const dispatchReleasesAmbulance = (to) => to === "COMPLETED" || to === "CANCELLED";

export const ambulanceSchema = z.object({
  vehicleNo: requiredText(40, "Vehicle number"),
  type: z.enum(AMBULANCE_TYPES, { error: "Choose the vehicle type" }),
  driverName: optionalText(120),
  driverPhone: phone,
});

export const ambulanceStatusSchema = z.object({
  status: z.enum(["AVAILABLE", "MAINTENANCE"]),
});

export const dispatchSchema = z.object({
  ambulanceId: z.string({ error: "Choose an ambulance" }).min(1, "Choose an ambulance").max(64),
  emergencyVisitId: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  pickupAddress: requiredText(300, "Pickup address"),
  destination: requiredText(200, "Destination"),
  callerName: optionalText(120),
  callerPhone: phone,
});

export const dispatchStatusSchema = z.object({
  status: z.enum(["ON_SCENE", "TRANSPORTING", "COMPLETED", "CANCELLED"]),
  reason: optionalText(300),
}).refine((v) => v.status !== "CANCELLED" || (v.reason && v.reason.length >= 3), { path: ["reason"], message: "Give a reason for cancelling" });
