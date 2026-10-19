import { Info } from "lucide-react";

export function InsuranceBanner() {
  return (
    <div role="note" className="mb-4 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-[13.5px] text-info flex gap-2">
      <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div><span className="font-semibold">Manual claim tracking — no insurer integration is configured.</span> Submit claims to insurers through their own channels and record decisions and settlements here.</div>
    </div>
  );
}
