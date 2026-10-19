"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles, Bookmark, BookmarkX, Wrench, RotateCcw, Brush } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mutate } from "@/components/ui/api-client";
import { BED_MANUAL_TRANSITIONS, bedActionLabel } from "@/lib/validation/inpatient";

function iconFor(from, to) {
  if (from === "CLEANING" && to === "AVAILABLE") return Sparkles;
  if (from === "OUT_OF_SERVICE" && to === "AVAILABLE") return RotateCcw;
  if (from === "RESERVED" && to === "AVAILABLE") return BookmarkX;
  if (to === "RESERVED") return Bookmark;
  if (to === "CLEANING") return Brush;
  return Wrench;
}

/** Allowed manual status changes for a (non-occupied) bed. */
export function BedStatusActions({ bed, onDone, size = "sm" }) {
  const router = useRouter();
  const [oos, setOos] = useState(false);
  const [busy, setBusy] = useState(null);
  const targets = BED_MANUAL_TRANSITIONS[bed.status] || [];

  async function go(status, reason) {
    setBusy(status);
    try {
      await mutate(`/api/beds/${bed.id}/status`, { status, reason }, { success: `Bed ${bed.label}: ${bedActionLabel(bed.status, status).toLowerCase()}` });
      onDone?.();
      router.refresh();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (bed.status === "OCCUPIED") {
    return <p className="text-xs text-muted">Occupied beds change status only through transfer or discharge.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((t) => (
        <Button key={t} size={size} variant={t === "AVAILABLE" ? "primary" : "secondary"} icon={iconFor(bed.status, t)} loading={busy === t}
          disabled={!!busy && busy !== t}
          onClick={() => (t === "OUT_OF_SERVICE" ? setOos(true) : go(t))}>
          {bedActionLabel(bed.status, t)}
        </Button>
      ))}
      <ConfirmDialog open={oos} onClose={() => setOos(false)} requireReason reasonLabel="Reason (e.g. broken rail, awaiting repair)"
        title={`Take bed ${bed.label} out of service?`}
        message="The bed will not be offered for admissions or transfers until it is returned to service."
        confirmLabel="Take out of service"
        onConfirm={async (reason) => { if (await go("OUT_OF_SERVICE", reason)) setOos(false); }} />
    </div>
  );
}
