"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, RotateCcw, Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { mutate } from "@/components/ui/api-client";
import { WEEKDAYS, findAvailabilityIssues, normalizeWindows, toMinutes, weeklyMinutes } from "@/lib/validation/staff";

const pad = (n) => String(n).padStart(2, "0");
const fromMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
// Display Monday first; weekday numbers stay 0=Sunday … 6=Saturday as stored.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function suggestNext(dayWindows) {
  if (!dayWindows.length) return { startTime: "09:00", endTime: "13:00" };
  const lastEnd = Math.max(...dayWindows.map((w) => (/^\d\d:\d\d$/.test(w.endTime) ? toMinutes(w.endTime) : 0)));
  const start = Math.min(lastEnd + 60, 22 * 60);
  return { startTime: fromMinutes(start), endTime: fromMinutes(Math.min(start + 180, 23 * 60 + 59)) };
}

const snapshot = (ws) => JSON.stringify(normalizeWindows(ws.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime }))));

export function AvailabilityEditor({ doctorId, initial, canEdit }) {
  const router = useRouter();
  const seq = useRef(0);
  // Deterministic keys for server-rendered rows (DB id or index); fresh keys only inside event handlers.
  const keyed = (ws, prefix) => ws.map((w, i) => ({ key: w.id ?? `${prefix}${i}`, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime }));
  const nextKey = () => `n${++seq.current}`;
  const [windows, setWindows] = useState(() => keyed(initial, "i"));
  const [saved, setSaved] = useState(() => snapshot(initial));
  const [busy, setBusy] = useState(false);

  const issues = useMemo(() => findAvailabilityIssues(windows), [windows]);
  const issueByKey = useMemo(() => {
    const m = {};
    for (const i of issues) m[windows[i.index].key] = i;
    return m;
  }, [issues, windows]);
  const dirty = snapshot(windows) !== saved;
  const totalHours = (weeklyMinutes(windows.filter((w) => !issueByKey[w.key])) / 60).toFixed(1).replace(/\.0$/, "");

  const update = (key, patch) => setWindows((ws) => ws.map((w) => (w.key === key ? { ...w, ...patch } : w)));
  const remove = (key) => setWindows((ws) => ws.filter((w) => w.key !== key));
  const add = (weekday) => setWindows([...windows, { key: nextKey(), weekday, ...suggestNext(windows.filter((w) => w.weekday === weekday)) }]);
  const copyDay = (from) => {
    const src = windows.filter((w) => w.weekday === from);
    const targets = [1, 2, 3, 4, 5].filter((d) => d !== from);
    setWindows([...windows.filter((w) => !targets.includes(w.weekday)), ...targets.flatMap((d) => src.map((w) => ({ key: nextKey(), weekday: d, startTime: w.startTime, endTime: w.endTime })))]);
  };
  const discard = () => setWindows(keyed(JSON.parse(saved), `d${++seq.current}-`));

  async function save() {
    setBusy(true);
    try {
      const body = { windows: windows.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })) };
      const rows = await mutate(`/api/doctors/${doctorId}/availability`, body, { method: "PUT", success: "Weekly availability saved" });
      setWindows(keyed(rows, `s${++seq.current}-`));
      setSaved(snapshot(rows));
      router.refresh();
    } catch { /* toast shown by mutate */ } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <p className="text-[13px] text-muted inline-flex items-center gap-1.5"><Clock size={14} aria-hidden /> {totalHours} h / week · times in hospital local time</p>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" icon={RotateCcw} disabled={!dirty || busy} onClick={discard}>Discard</Button>
            <Button size="sm" variant="primary" icon={Save} loading={busy} disabled={!dirty || issues.length > 0} onClick={save}>Save availability</Button>
          </div>
        )}
      </div>
      {canEdit && issues.length > 0 && (
        <p role="alert" className="mx-4 mt-3 rounded-md bg-danger-soft text-danger text-[12.5px] px-3 py-2">Fix {issues.length} problem{issues.length === 1 ? "" : "s"} before saving.</p>
      )}
      <ul className="divide-y divide-border">
        {ORDER.map((wd) => {
          const dayWindows = windows.filter((w) => w.weekday === wd).sort((a, b) => (a.startTime > b.startTime ? 1 : -1));
          return (
            <li key={wd} className="px-4 py-3 grid gap-2 sm:grid-cols-[120px_1fr] sm:items-start">
              <div className="flex items-center justify-between sm:block">
                <p className="font-semibold text-[13.5px] sm:pt-1.5">{WEEKDAYS[wd]}</p>
                {dayWindows.length === 0 && <Badge tone="neutral" plain className="sm:mt-1">Off</Badge>}
              </div>
              <div className="space-y-2">
                {!canEdit && dayWindows.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 sm:pt-1">
                    {dayWindows.map((w) => <Badge key={w.key} tone="primary" plain className="tabular">{w.startTime}–{w.endTime}</Badge>)}
                  </div>
                )}
                {canEdit && dayWindows.map((w) => {
                  const issue = issueByKey[w.key];
                  const errId = `${w.key}-err`;
                  return (
                    <div key={w.key}>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`${w.key}-s`}>{WEEKDAYS[wd]} start time</label>
                        <input id={`${w.key}-s`} type="time" step={300} className="input w-[120px] tabular" value={w.startTime} onChange={(e) => update(w.key, { startTime: e.target.value })}
                          aria-invalid={issue?.field === "startTime" || undefined} aria-describedby={issue ? errId : undefined} />
                        <span className="text-subtle text-sm" aria-hidden>–</span>
                        <label className="sr-only" htmlFor={`${w.key}-e`}>{WEEKDAYS[wd]} end time</label>
                        <input id={`${w.key}-e`} type="time" step={300} className="input w-[120px] tabular" value={w.endTime} onChange={(e) => update(w.key, { endTime: e.target.value })}
                          aria-invalid={issue?.field === "endTime" || undefined} aria-describedby={issue ? errId : undefined} />
                        <Button size="sm" variant="ghost" iconOnly icon={Trash2} onClick={() => remove(w.key)} aria-label={`Remove ${WEEKDAYS[wd]} ${w.startTime}–${w.endTime}`} />
                      </div>
                      {issue && <p id={errId} className="field-error" role="alert">{issue.message}</p>}
                    </div>
                  );
                })}
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" icon={Plus} onClick={() => add(wd)} disabled={dayWindows.length >= 12}>Add window</Button>
                    {wd >= 1 && wd <= 5 && dayWindows.length > 0 && <Button size="sm" variant="ghost" onClick={() => copyDay(wd)}>Copy to Mon–Fri</Button>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
