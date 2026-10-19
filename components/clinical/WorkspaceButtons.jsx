"use client";
import { useState } from "react";
import { Activity, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { VitalsDialog } from "./VitalsDialog";

export function RecordVitalsButton({ encounterId, subtitle }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={Activity} onClick={() => setOpen(true)}>Record vitals</Button>
      <VitalsDialog open={open} onClose={() => setOpen(false)} endpoint={`/api/encounters/${encounterId}/vitals`} subtitle={subtitle} />
    </>
  );
}

export function PrintButton({ label = "Print" }) {
  return <Button variant="primary" icon={Printer} onClick={() => window.print()}>{label}</Button>;
}
