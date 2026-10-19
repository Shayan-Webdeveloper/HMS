import { Badge } from "@/components/ui/Badge";

const TONES = { DRAFT: "neutral", SUBMITTED: "info", APPROVED: "success", PARTIALLY_APPROVED: "warning", REJECTED: "danger", PAID: "teal" };

/** Claim-specific colours (the shared StatusBadge has no tone for SUBMITTED / PARTIALLY_APPROVED). */
export function ClaimStatusBadge({ status }) {
  if (!status) return null;
  return <Badge tone={TONES[status] || "neutral"}>{status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function PolicyStatusBadge({ isActive, expired }) {
  if (!isActive) return <Badge tone="neutral">Inactive</Badge>;
  if (expired) return <Badge tone="warning">Expired</Badge>;
  return <Badge tone="success">Active</Badge>;
}
