"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Save, CheckCheck, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { mutate } from "@/components/ui/api-client";
import { ATTENDANCE_STATUS, humanize, summarizeAttendance } from "@/lib/validation/staff";
import { addDays } from "@/lib/utils/time";

const TONE = { PRESENT: "success", LATE: "warning", HALF_DAY: "info", ABSENT: "danger", ON_LEAVE: "primary", UNMARKED: "neutral" };

export function AttendanceSheet({ date, today, rows, canEdit, departments, departmentId }) {
  const router = useRouter();
  const [nav, startNav] = useTransition();
  const [values, setValues] = useState(() => Object.fromEntries(rows.map((r) => [r.staffId, { status: r.status ?? "", note: r.note ?? "" }])));
  const val = (r) => values[r.staffId] ?? { status: r.status ?? "", note: r.note ?? "" };
  const [busy, setBusy] = useState(false);
  const future = date > today;
  const editable = canEdit && !future;

  const changed = rows.filter((r) => {
    const v = val(r);
    return v.status && (v.status !== (r.status ?? "") || v.note.trim() !== (r.note ?? ""));
  });
  const summary = summarizeAttendance(rows.map((r) => ({ status: val(r).status || null })));

  function go(params) {
    const sp = new URLSearchParams({ tab: "attendance", date, ...(departmentId ? { departmentId } : {}), ...params });
    for (const [k, v] of [...sp.entries()]) if (!v) sp.delete(k);
    startNav(() => router.push(`/staff?${sp.toString()}`, { scroll: false }));
  }
  const set = (r, patch) => setValues((v) => ({ ...v, [r.staffId]: { ...(v[r.staffId] ?? { status: r.status ?? "", note: r.note ?? "" }), ...patch } }));
  function markUnmarked() {
    setValues((v) => {
      const next = { ...v };
      for (const r of rows) {
        const cur = next[r.staffId] ?? { status: r.status ?? "", note: r.note ?? "" };
        if (!cur.status) next[r.staffId] = { ...cur, status: r.approvedLeave ? "ON_LEAVE" : "PRESENT" };
      }
      return next;
    });
  }
  async function save() {
    setBusy(true);
    try {
      const entries = changed.map((r) => ({ staffId: r.staffId, status: val(r).status, note: val(r).note.trim() || undefined }));
      await mutate("/api/hr/attendance", { date, entries }, { method: "PUT", success: `Attendance saved for ${entries.length} staff member${entries.length === 1 ? "" : "s"}` });
      router.refresh();
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 p-3 border-b border-border md:flex-row md:items-center md:flex-wrap">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" iconOnly icon={ChevronLeft} onClick={() => go({ date: addDays(date, -1) })} aria-label="Previous day" />
          <label htmlFor="att-date" className="sr-only">Attendance date</label>
          <input id="att-date" type="date" className="input w-[160px]" value={date} max={today} onChange={(e) => e.target.value && go({ date: e.target.value })} />
          <Button size="sm" variant="ghost" iconOnly icon={ChevronRight} onClick={() => go({ date: addDays(date, 1) })} disabled={date >= today} aria-label="Next day" />
          {date !== today && <Button size="sm" variant="ghost" onClick={() => go({ date: today })}>Today</Button>}
          {nav && <Loader2 size={14} className="animate-spin text-subtle ml-1" aria-label="Loading" />}
        </div>
        <label htmlFor="att-dept" className="sr-only">Department</label>
        <select id="att-dept" className="select md:w-auto md:min-w-[180px]" value={departmentId || ""} onChange={(e) => go({ departmentId: e.target.value })}>
          <option value="">Department: All</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {editable && (
          <div className="flex gap-2 md:ml-auto">
            <Button size="sm" icon={CheckCheck} onClick={markUnmarked} disabled={summary.UNMARKED === 0}>Mark unmarked present</Button>
            <Button size="sm" variant="primary" icon={Save} loading={busy} disabled={changed.length === 0} onClick={save}>
              Save{changed.length ? ` (${changed.length})` : ""}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border" aria-label="Attendance summary">
        {[...ATTENDANCE_STATUS, "UNMARKED"].map((s) => (
          <Badge key={s} tone={TONE[s]}><span>{humanize(s)}</span><span className="tabular font-bold">{summary[s]}</span></Badge>
        ))}
        <span className="text-xs text-subtle self-center ml-auto">{summary.total} staff{changed.length > 0 && <> · <span className="text-warning font-semibold">{changed.length} unsaved</span></>}</span>
      </div>

      {future && <p className="px-4 py-2 text-[13px] text-warning bg-warning-soft">Attendance cannot be recorded for a future date.</p>}
      {canEdit === false && <p className="px-4 py-2 text-[12.5px] text-muted border-b border-border">Read-only — recording attendance requires the hr:manage permission.</p>}

      {rows.length === 0 ? (
        <EmptyState icon={Users} title="No staff to show" description="No active staff match this department." />
      ) : (
        <div className="table-wrap">
          <table className="table table-responsive">
            <caption className="sr-only">Attendance for {date}</caption>
            <thead><tr><th scope="col">Employee</th><th scope="col">Department</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const v = val(r);
                const dirty = changed.includes(r);
                return (
                  <tr key={r.staffId} className={dirty ? "bg-warning-soft/40" : undefined}>
                    <td data-label="Employee">
                      <div className="text-left">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted"><span className="font-mono">{r.employeeNo}</span> · {r.position}</p>
                        {r.approvedLeave && <Badge tone="info" plain className="mt-1">Approved leave · {humanize(r.approvedLeave)}</Badge>}
                      </div>
                    </td>
                    <td data-label="Department">{r.department || "—"}</td>
                    <td data-label="Status">
                      {editable ? (
                        <select className="select min-w-[150px]" aria-label={`Status for ${r.name}`} value={v.status} onChange={(e) => set(r, { status: e.target.value })}>
                          <option value="" disabled={!!r.status}>— Not marked —</option>
                          {ATTENDANCE_STATUS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                        </select>
                      ) : r.status ? <Badge tone={TONE[r.status]}>{humanize(r.status)}</Badge> : <span className="text-subtle">Not marked</span>}
                    </td>
                    <td data-label="Note">
                      {editable ? (
                        <input className="input min-w-[160px]" aria-label={`Note for ${r.name}`} value={v.note} maxLength={200} onChange={(e) => set(r, { note: e.target.value })} placeholder="Optional" />
                      ) : (r.note || "—")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
