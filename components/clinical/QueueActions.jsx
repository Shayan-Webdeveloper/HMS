"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Megaphone, Stethoscope, FileText } from "lucide-react";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { VitalsDialog } from "./VitalsDialog";

export function QueueActions({ entry, perms }) {
  const router = useRouter();
  const [vitals, setVitals] = useState(false);
  const [busy, setBusy] = useState(null);
  const active = ["WAITING", "CALLED", "IN_CONSULTATION"].includes(entry.status);

  async function call() {
    setBusy("call");
    try { await mutate(`/api/queue/${entry.id}`, { action: "call" }, { method: "PATCH", success: `Token #${entry.token} called` }); router.refresh(); } catch {} finally { setBusy(null); }
  }
  async function start() {
    setBusy("start");
    try {
      const d = await mutate(`/api/appointments/${entry.appointmentId}/start`, undefined, { success: "Consultation started" });
      router.push(`/consultations/${d.encounterId}`);
    } catch { setBusy(null); }
  }

  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {active && perms.vitals && <Button size="sm" icon={Activity} onClick={() => setVitals(true)}>Vitals</Button>}
      {entry.status === "WAITING" && perms.call && <Button size="sm" icon={Megaphone} loading={busy === "call"} onClick={call}>Call</Button>}
      {entry.appointmentStatus === "CHECKED_IN" && perms.start && <Button size="sm" variant="primary" icon={Stethoscope} loading={busy === "start"} onClick={start}>Start</Button>}
      {entry.encounterId && perms.clinical && <Button size="sm" variant={entry.status === "IN_CONSULTATION" ? "primary" : "secondary"} icon={FileText} href={`/consultations/${entry.encounterId}`}>Open</Button>}
      {perms.vitals && <VitalsDialog open={vitals} onClose={() => setVitals(false)} endpoint={`/api/queue/${entry.id}/vitals`} subtitle={`Token #${entry.token} · ${entry.patientName}`} />}
    </div>
  );
}
