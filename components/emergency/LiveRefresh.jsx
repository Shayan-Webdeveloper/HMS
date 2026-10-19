"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

/** Re-fetches the server-rendered board on an interval (paused while the tab is hidden). */
export function LiveRefresh({ seconds = 30 }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [updated, setUpdated] = useState("");
  useEffect(() => {
    const stamp = () => setUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    stamp();
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      start(() => router.refresh());
      stamp();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return (
    <div className="inline-flex items-center gap-2 text-xs text-muted" aria-live="polite">
      <span className="relative flex w-2 h-2" aria-hidden><span className="absolute inline-flex w-full h-full rounded-full bg-success opacity-60 animate-ping" /><span className="relative inline-flex w-2 h-2 rounded-full bg-success" /></span>
      <span>Live · refreshes every {seconds}s{updated ? ` · updated ${updated}` : ""}</span>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Refresh now" onClick={() => { start(() => router.refresh()); setUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })); }}>
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
      </button>
    </div>
  );
}
