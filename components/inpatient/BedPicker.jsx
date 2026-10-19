"use client";
import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/components/ui/api-client";

/**
 * Ward → available bed picker (controlled). Beds are fetched live so the list reflects
 * the current board; the server still re-checks availability atomically on submit.
 */
export function BedPicker({ wards, wardId, bedId, onWardChange, onBedChange, excludeBedId, wardError, bedError, refreshKey = 0 }) {
  const wid = useId(), bid = useId();
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!wardId) { setBeds([]); return; }
    const ctl = new AbortController();
    setLoading(true);
    setLoadError("");
    api(`/api/beds?wardId=${encodeURIComponent(wardId)}&status=AVAILABLE`, { signal: ctl.signal })
      .then((r) => setBeds(r.data.filter((b) => b.id !== excludeBedId)))
      .catch((e) => { if (e.name !== "AbortError") setLoadError("Could not load beds. Try again."); })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [wardId, excludeBedId, refreshKey]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label htmlFor={wid} className="field-label">Ward<span className="req" aria-hidden>*</span></label>
        <select id={wid} className="select" value={wardId || ""} aria-invalid={!!wardError || undefined}
          onChange={(e) => { onWardChange(e.target.value); onBedChange(""); }}>
          <option value="">Select ward…</option>
          {wards.map((w) => <option key={w.id} value={w.id} disabled={w.available === 0}>{w.name} ({w.code}) — {w.available} free · {w.dailyRateLabel}/day</option>)}
        </select>
        {wardError && <p className="field-error" role="alert">{wardError}</p>}
      </div>
      <div>
        <label htmlFor={bid} className="field-label">Bed<span className="req" aria-hidden>*</span></label>
        <div className="relative">
          <select id={bid} className="select" value={bedId || ""} disabled={!wardId || loading} aria-invalid={!!bedError || undefined} onChange={(e) => onBedChange(e.target.value)}>
            <option value="">{!wardId ? "Choose a ward first" : loading ? "Loading beds…" : beds.length ? "Select bed…" : "No available beds"}</option>
            {beds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          {loading && <Loader2 size={14} className="absolute right-8 top-1/2 -translate-y-1/2 animate-spin text-subtle" aria-hidden />}
        </div>
        {(bedError || loadError) && <p className="field-error" role="alert">{bedError || loadError}</p>}
      </div>
    </div>
  );
}
