"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "@/lib/utils/time";

/** Previous / next / today navigation for a day view (URL param `date`). */
export function DayNav({ date, today, label }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const go = (d) => {
    const next = new URLSearchParams(sp.toString());
    if (d) next.set("date", d); else next.delete("date");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Previous day" onClick={() => go(addDays(date, -1))}><ChevronLeft size={15} /></button>
      <input type="date" className="input !h-[30px] !w-[150px]" aria-label="Schedule date" value={date} onChange={(e) => e.target.value && go(e.target.value)} />
      <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Next day" onClick={() => go(addDays(date, 1))}><ChevronRight size={15} /></button>
      {date !== today && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(today)}>Today</button>}
      {label && <span className="text-[13px] font-semibold ml-1">{label}</span>}
    </div>
  );
}
