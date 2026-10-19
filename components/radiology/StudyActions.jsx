"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Play, BadgeCheck, Ban, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { mutate } from "@/components/ui/api-client";

export function StudyActions({ study, perms, tz }) {
  const router = useRouter();
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(null);
  const base = `/api/radiology/studies/${study.id}`;
  const close = () => setDialog(null);
  async function run(key, url, body, success) {
    setBusy(key);
    try { await mutate(url, body ?? {}, { success }); close(); router.refresh(); }
    catch { /* toast shown */ }
    finally { setBusy(null); }
  }
  const s = study.status;
  const canCancel = perms.cancel && ["REQUESTED", "SCHEDULED", "IN_PROGRESS"].includes(s);
  return (
    <div className="flex flex-wrap gap-2">
      {perms.report && (s === "REQUESTED" || s === "SCHEDULED") && (
        <>
          <Button variant={s === "REQUESTED" ? "primary" : "secondary"} icon={CalendarClock} onClick={() => setDialog("schedule")}>{s === "SCHEDULED" ? "Reschedule" : "Schedule"}</Button>
          <Button variant={s === "SCHEDULED" ? "primary" : "secondary"} icon={Play} loading={busy === "start"} onClick={() => setDialog("start")}>Start study</Button>
        </>
      )}
      {perms.verify && s === "REPORTED" && <Button variant="success" icon={BadgeCheck} onClick={() => setDialog("verify")}>Verify report</Button>}
      {s === "VERIFIED" && <Button icon={Printer} href={`/radiology/${study.id}/report`}>Print report</Button>}
      {canCancel && <Button variant="ghost" icon={Ban} onClick={() => setDialog("cancel")}>Cancel study</Button>}

      {dialog === "schedule" && <ScheduleDialog study={study} tz={tz} busy={busy === "schedule"} onClose={close}
        onSubmit={(body) => run("schedule", `${base}/schedule`, body, s === "SCHEDULED" ? "Study rescheduled" : "Study scheduled")} />}
      <ConfirmDialog open={dialog === "start"} onClose={close} tone="primary" title="Start this study?"
        message="Marks the patient as being imaged now. Report entry becomes available." confirmLabel="Start study"
        onConfirm={() => run("start", `${base}/start`, null, "Study started")} />
      <ConfirmDialog open={dialog === "verify"} onClose={close} tone="primary" title="Verify and release this report?"
        message={`Verified reports are final and visible to the requesting clinician and the patient portal.${study.selfVerify ? " You also entered this report; self-verification will be recorded in the audit trail." : ""}`}
        confirmLabel="Verify report" onConfirm={() => run("verify", `${base}/verify`, null, "Report verified")} />
      <ConfirmDialog open={dialog === "cancel"} onClose={close} requireReason title={`Cancel study ${study.studyNo}?`}
        message="The request will be cancelled and the requesting clinician notified. This cannot be undone." confirmLabel="Cancel study"
        onConfirm={(reason) => run("cancel", `${base}/cancel`, { reason }, "Study cancelled")} />
    </div>
  );
}

function ScheduleDialog({ study, tz, busy, onClose, onSubmit }) {
  const [date, setDate] = useState(study.defaultDate);
  const [time, setTime] = useState(study.defaultTime);
  const [error, setError] = useState("");
  function go() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setError("Choose a valid date and time."); return; }
    onSubmit({ date, time });
  }
  return (
    <Modal open onClose={() => !busy && onClose()} title={study.status === "SCHEDULED" ? "Reschedule study" : "Schedule study"}
      description={`Times are in hospital time (${tz}).`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Save schedule</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="field-label" htmlFor="sch-date">Date<span className="req">*</span></label>
          <input id="sch-date" type="date" className="input" value={date} min={study.minDate} onChange={(e) => { setDate(e.target.value); setError(""); }} aria-invalid={!!error} />
        </div>
        <div>
          <label className="field-label" htmlFor="sch-time">Time<span className="req">*</span></label>
          <input id="sch-time" type="time" step={300} className="input" value={time} onChange={(e) => { setTime(e.target.value); setError(""); }} aria-invalid={!!error} />
        </div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>
  );
}
