"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Re-fetches server data periodically while the tab is visible, so worklist counts stay live. */
export function AutoRefresh({ seconds = 60 }) {
  const router = useRouter();
  const [last, setLast] = useState(null);
  useEffect(() => {
    setLast(new Date());
    const t = setInterval(() => {
      if (document.visibilityState === "visible") { router.refresh(); setLast(new Date()); }
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return (
    <p className="no-print text-xs text-subtle inline-flex items-center gap-1.5" aria-live="polite">
      <RefreshCw size={12} aria-hidden /> Live worklist: refreshes every {seconds} s
      {last && <span>· updated {last.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      <button type="button" className="text-primary hover:underline ml-1" onClick={() => { router.refresh(); setLast(new Date()); }}>Refresh now</button>
    </p>
  );
}
