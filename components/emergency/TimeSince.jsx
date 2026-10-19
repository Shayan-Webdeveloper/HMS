"use client";
import { useEffect, useState } from "react";
import { formatWait } from "@/lib/validation/emergency";

/** Live "time since" label. `initial` is computed on the server to avoid hydration mismatch. */
export function TimeSince({ since, initial, warnAfterMin }) {
  const [label, setLabel] = useState(initial);
  const [mins, setMins] = useState(null);
  useEffect(() => {
    const tick = () => { const m = (Date.now() - new Date(since).getTime()) / 60000; setMins(m); setLabel(formatWait(m)); };
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [since]);
  const warn = warnAfterMin != null && mins != null && mins >= warnAfterMin;
  return <time dateTime={since} className={`tabular font-semibold ${warn ? "text-danger" : ""}`}>{label}</time>;
}
