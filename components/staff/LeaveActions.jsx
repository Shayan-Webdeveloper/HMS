"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Ban } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mutate } from "@/components/ui/api-client";

const COPY = {
  approve: { title: "Approve leave request?", label: "Approve", tone: "primary", success: "Leave approved", reason: false },
  reject: { title: "Reject leave request?", label: "Reject", tone: "danger", success: "Leave rejected", reason: true },
  cancel: { title: "Cancel leave request?", label: "Cancel request", tone: "danger", success: "Leave request cancelled", reason: true },
};

/** Row actions for a leave request. Server re-checks permissions, self-approval and state. */
export function LeaveActions({ leave, canDecide, canCancel }) {
  const router = useRouter();
  const [action, setAction] = useState(null);
  const pending = leave.status === "PENDING";
  const showDecide = canDecide && pending && !leave.isOwn;
  const showCancel = canCancel && (pending || (leave.status === "APPROVED" && !leave.ended));
  if (!showDecide && !showCancel) return <span className="text-subtle text-xs">—</span>;
  const c = action ? COPY[action] : null;
  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {showDecide && <Button size="sm" variant="success" icon={Check} onClick={() => setAction("approve")}>Approve</Button>}
      {showDecide && <Button size="sm" icon={X} onClick={() => setAction("reject")}>Reject</Button>}
      {showCancel && <Button size="sm" variant="ghost" icon={Ban} onClick={() => setAction("cancel")} aria-label={`Cancel leave request for ${leave.staffName}`}>Cancel</Button>}
      <ConfirmDialog open={!!action} onClose={() => setAction(null)} requireReason={c?.reason} tone={c?.tone}
        title={c?.title || ""}
        message={c ? `${leave.staffName} · ${leave.summary}` : ""}
        confirmLabel={c?.label}
        reasonLabel={action === "reject" ? "Reason for rejection" : "Reason"}
        onConfirm={async (reason) => {
          try {
            await mutate(`/api/hr/leave/${leave.id}`, { action, reason: reason || undefined }, { success: c.success });
            setAction(null);
            router.refresh();
          } catch { /* toast shown */ }
        }} />
    </div>
  );
}
