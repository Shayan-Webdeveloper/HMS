"use client";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Date input that sets ?date= (keeps every other filter). */
export function DateJump({ value }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div className="relative">
      <input type="date" className="input w-[160px]" aria-label="Go to date" value={value}
        onChange={(e) => {
          if (!e.target.value) return;
          const next = new URLSearchParams(sp.toString());
          next.set("date", e.target.value);
          start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
        }} />
      {pending && <Loader2 size={14} className="absolute right-9 top-1/2 -translate-y-1/2 animate-spin text-subtle" aria-hidden />}
    </div>
  );
}
