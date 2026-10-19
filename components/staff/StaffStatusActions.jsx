"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserCheck, UserX, Ban, Plane } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mutate } from "@/components/ui/api-client";
import { EMPLOYMENT_TRANSITIONS, REVOKING_STATUSES } from "@/lib/validation/staff";

const ACTIONS = {
  ACTIVE: { label: "Reactivate", icon: UserCheck, tone: "primary" },
  ON_LEAVE: { label: "Mark on leave", icon: Plane, tone: "primary" },
  SUSPENDED: { label: "Suspend", icon: Ban, tone: "danger" },
  TERMINATED: { label: "Terminate", icon: UserX, tone: "danger" },
};

function describe(to, from, name, hasAccount) {
  const acct = hasAccount ? " Their login is deactivated and every active session is signed out immediately." : "";
  switch (to) {
    case "SUSPENDED": return `${name} will be suspended.${acct} Records are preserved and the suspension can be lifted later.`;
    case "TERMINATED": return `${name}'s employment will be marked terminated.${acct} All historical records are preserved.`;
    case "ON_LEAVE": return `${name} will be marked as on leave. ${hasAccount ? "Their login stays active." : ""}`;
    case "ACTIVE": return REVOKING_STATUSES.includes(from)
      ? `${name} will be reinstated as active.${hasAccount ? " Their login account is re-enabled." : ""}`
      : `${name} will be marked as back at work.`;
    default: return "";
  }
}

export function StaffStatusActions({ staff, isSelf }) {
  const router = useRouter();
  const [target, setTarget] = useState(null);
  const options = EMPLOYMENT_TRANSITIONS[staff.employmentStatus] || [];
  if (isSelf) return <p className="text-xs text-muted">You cannot change your own employment status.</p>;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {options.map((to) => {
          const a = ACTIONS[to];
          const label = to === "ACTIVE" && staff.employmentStatus === "ON_LEAVE" ? "Mark back at work" : a.label;
          return <Button key={to} size="sm" icon={a.icon} className={a.tone === "danger" ? "text-danger" : undefined} onClick={() => setTarget(to)}>{label}</Button>;
        })}
      </div>
      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} requireReason
        tone={target && ACTIONS[target].tone === "danger" ? "danger" : "primary"}
        title={target ? `${ACTIONS[target].label} — ${staff.name}?` : ""}
        message={target ? describe(target, staff.employmentStatus, staff.name, staff.hasAccount) : ""}
        confirmLabel={target ? ACTIONS[target].label : "Confirm"}
        onConfirm={async (reason) => {
          try {
            const r = await mutate(`/api/staff/${staff.id}/status`, { status: target, reason });
            const extra = r.account === "deactivated" ? ` Login disabled; ${r.sessionsRevoked} session(s) signed out.` : r.account === "reactivated" ? " Login re-enabled." : "";
            toast.success(`Status changed to ${target.replace("_", " ").toLowerCase()}.${extra}`);
            if (r.futureAppointments > 0) toast.warning(`${r.futureAppointments} upcoming appointment(s) are booked with this doctor and need reassignment.`, { duration: 8000 });
            setTarget(null);
            router.refresh();
          } catch { /* toast shown */ }
        }} />
    </>
  );
}
