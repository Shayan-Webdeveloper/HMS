import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { formatDateTime, formatDateOnly } from "@/lib/utils/time";
import { humanize } from "@/lib/validation/pharmacy";

export const MOVEMENT_TONES = { RECEIPT: "success", DISPENSE: "primary", RETURN: "info", ADJUSTMENT: "warning", EXPIRED: "danger", ISSUE: "primary", TRANSFER: "neutral" };

export function MovementBadge({ type }) {
  return <Badge tone={MOVEMENT_TONES[type] || "neutral"}>{humanize(type)}</Badge>;
}

export function SignedQty({ value }) {
  return <span className={`font-semibold tabular ${value < 0 ? "text-danger" : "text-success"}`}>{value > 0 ? `+${value}` : value}</span>;
}

/** Medication stock-ledger table (ledger tab and medication page). Server component. */
export function MedicationLedgerTable({ rows, tz, showMedication = true }) {
  return (
    <DataTable rows={rows} caption="Stock movements"
      empty={<EmptyState title="No stock movements" description="Receipts, dispensing, returns, adjustments and write-offs are recorded here." />}
      columns={[
        { key: "at", label: "When", render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt, tz)}</span> },
        ...(showMedication ? [{ key: "med", label: "Medicine", render: (r) => (r.medication ? <Link href={`/pharmacy/medications/${r.medication.id}`} className="font-medium hover:text-primary">{r.medication.genericName} {r.medication.strength}</Link> : "—") }] : []),
        { key: "batch", label: "Batch", render: (r) => (r.batch ? <span><span className="font-mono text-[12.5px]">{r.batch.batchNo}</span> <span className="text-xs text-subtle whitespace-nowrap">exp. {formatDateOnly(r.batch.expiryDate)}</span></span> : "—") },
        { key: "type", label: "Type", render: (r) => <MovementBadge type={r.type} /> },
        { key: "qty", label: "Qty", align: "right", render: (r) => <SignedQty value={r.quantity} /> },
        { key: "bal", label: "Batch balance", align: "right", render: (r) => r.balanceAfter },
        { key: "ref", label: "Reference", render: (r) => (r.prescription ? <Link href={`/pharmacy/prescriptions/${r.prescription.id}`} className="font-mono text-[12.5px] text-primary hover:underline">{r.prescription.prescriptionNo}</Link> : "—") },
        { key: "reason", label: "Reason", render: (r) => <span className="text-[13px] text-muted">{r.reason || "—"}</span> },
        { key: "by", label: "By", render: (r) => r.performedByName },
      ]} />
  );
}
