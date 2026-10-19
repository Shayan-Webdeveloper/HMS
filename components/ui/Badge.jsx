import { cn } from "@/lib/utils/cn";

export function Badge({ tone = "neutral", plain, className, children }) {
  return <span className={cn("badge", `badge-${tone}`, plain && "badge-plain", className)}>{children}</span>;
}

// Meaningful, consistent status colours across modules.
export const TONES = {
  // generic
  ACTIVE: "success", INACTIVE: "neutral", ARCHIVED: "neutral", DECEASED: "neutral", MERGED: "neutral",
  // appointments
  REQUESTED: "info", SCHEDULED: "primary", CONFIRMED: "teal", CHECKED_IN: "warning", IN_PROGRESS: "info",
  COMPLETED: "success", CANCELLED: "neutral", NO_SHOW: "danger",
  // encounters / prescriptions
  DRAFT: "neutral", FINALIZED: "success", PARTIALLY_DISPENSED: "warning", DISPENSED: "success",
  // lab
  SAMPLE_COLLECTED: "info", PROCESSING: "info", AWAITING_VALIDATION: "warning", RELEASED: "success", REJECTED: "danger",
  // admissions / beds
  ADMITTED: "primary", DISCHARGED: "success", TRANSFERRED_OUT: "neutral", AVAILABLE: "success", OCCUPIED: "primary",
  RESERVED: "info", CLEANING: "warning", OUT_OF_SERVICE: "neutral",
  // billing
  ISSUED: "primary", PARTIALLY_PAID: "warning", PAID: "success", VOID: "neutral", REFUNDED: "info",
  // queue
  WAITING: "warning", CALLED: "info", IN_CONSULTATION: "info", DONE: "success", LEFT: "neutral",
  // emergency
  WAITING_TRIAGE: "danger", TRIAGED: "warning", UNDER_TREATMENT: "info", TRANSFERRED: "neutral", LEFT_WITHOUT_BEING_SEEN: "neutral",
  // imaging
  REPORTED: "warning", VERIFIED: "success",
  // HR
  PENDING: "warning", APPROVED: "success", ON_LEAVE: "info", SUSPENDED: "danger", TERMINATED: "neutral",
  // urgency
  ROUTINE: "neutral", URGENT: "warning", STAT: "danger",
  HIGH: "danger", LOW: "warning", NORMAL: "success", ABNORMAL: "danger",
  // insurance
  SUBMITTED: "info", PARTIALLY_APPROVED: "warning", EXPIRED: "warning",
};

export function StatusBadge({ status, label }) {
  if (!status) return null;
  const text = label ?? String(status).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return <Badge tone={TONES[status] || "neutral"}>{text}</Badge>;
}
