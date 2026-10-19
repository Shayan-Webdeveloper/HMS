"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ClipboardList, Stethoscope, Play, Flag, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { api, mutate } from "@/components/ui/api-client";
import { canTriage, canErTransition, dispositionsFrom, isErActive, erLabel } from "@/lib/validation/emergency";

const DISPO_HELP = {
  DISCHARGED: "Patient leaves the ER home or to self-care.",
  ADMITTED: "Patient is to be admitted to a ward. You will be taken to the admission form.",
  TRANSFERRED: "Patient is transferred to another facility.",
  LEFT_WITHOUT_BEING_SEEN: "Patient left before being seen by a clinician.",
};

export function ErVisitActions({ visit, categories, canManage, canAdmit }) {
  const [dialog, setDialog] = useState(null);
  if (!canManage) return null;
  const active = isErActive(visit.status);
  return (
    <div className="flex flex-wrap gap-2">
      {canTriage(visit.status) && <Button variant={visit.status === "WAITING_TRIAGE" ? "primary" : "secondary"} icon={ClipboardList} onClick={() => setDialog("triage")}>{visit.triageCategory ? "Re-triage" : "Triage"}</Button>}
      {active && <Button icon={Stethoscope} onClick={() => setDialog("assign")}>{visit.assignedClinicianId ? "Change clinician" : "Assign clinician"}</Button>}
      {canErTransition(visit.status, "UNDER_TREATMENT") && <Button variant="primary" icon={Play} onClick={() => setDialog("treat")}>Start treatment</Button>}
      {dispositionsFrom(visit.status).length > 0 && <Button icon={Flag} onClick={() => setDialog("dispo")}>Disposition…</Button>}
      {visit.status === "ADMITTED" && canAdmit && <Button variant="primary" icon={UserPlus} href={`/admissions/new?patientId=${visit.patientId}`}>Complete ward admission</Button>}
      {dialog === "triage" && <TriageDialog visit={visit} categories={categories} onClose={() => setDialog(null)} />}
      {dialog === "assign" && <ClinicianDialog visit={visit} mode="assign" onClose={() => setDialog(null)} />}
      {dialog === "treat" && <ClinicianDialog visit={visit} mode="treat" onClose={() => setDialog(null)} />}
      {dialog === "dispo" && <DispositionDialog visit={visit} canAdmit={canAdmit} onClose={() => setDialog(null)} />}
    </div>
  );
}

function TriageDialog({ visit, categories, onClose }) {
  const router = useRouter();
  const [cat, setCat] = useState(visit.triageCategory || "");
  const [obs, setObs] = useState(visit.initialObservations || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!cat) { setError("Choose a triage category"); return; }
    setBusy(true);
    try {
      await mutate(`/api/emergency/${visit.id}/triage`, { triageCategory: cat, initialObservations: obs }, { success: "Triage recorded" });
      onClose(); router.refresh();
    } catch (e) { setError(e.fields?.triageCategory || ""); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={visit.triageCategory ? "Re-triage patient" : "Triage patient"} description="Choose the category based on your clinical assessment. The system does not suggest or calculate a category."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Save triage</Button></>}>
      <div className="space-y-4">
        <fieldset>
          <legend className="field-label">Triage category<span className="req" aria-hidden>*</span></legend>
          <div className="grid gap-2" role="radiogroup">
            {categories.map((c) => (
              <label key={c.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${cat === c.key ? "bg-primary-soft border-primary" : "border-border hover:bg-surface-2"}`}>
                <input type="radio" name="triage" className="checkbox" checked={cat === c.key} onChange={() => { setCat(c.key); setError(""); }} />
                <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: c.color }} aria-hidden />
                <span className="font-semibold text-[13.5px]">{c.key}</span>
                <span className="text-[13px] text-muted">{c.label}</span>
              </label>
            ))}
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </fieldset>
        <div>
          <label className="field-label" htmlFor="triage-obs">Initial observations</label>
          <textarea id="triage-obs" className="textarea" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="e.g. BP 150/95, HR 110, SpO₂ 95% RA, GCS 15" />
        </div>
      </div>
    </Modal>
  );
}

function ClinicianDialog({ visit, mode, onClose }) {
  const router = useRouter();
  const [list, setList] = useState(null);
  const [clinicianId, setClinicianId] = useState(visit.assignedClinicianId || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    api("/api/emergency/clinicians", { signal: ctl.signal }).then((r) => setList(r.data)).catch(() => setList([]));
    return () => ctl.abort();
  }, []);
  async function go() {
    if (!clinicianId) { setError("Choose a clinician"); return; }
    setBusy(true);
    try {
      if (mode === "assign") await mutate(`/api/emergency/${visit.id}/assign`, { clinicianId }, { success: "Clinician assigned" });
      else await mutate(`/api/emergency/${visit.id}/treatment`, { clinicianId }, { success: "Treatment started" });
      onClose(); router.refresh();
    } catch (e) { setError(e.fields?.clinicianId || ""); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={mode === "assign" ? "Assign treating clinician" : "Start treatment"} description={mode === "treat" ? "The visit moves to “Under treatment” with the selected clinician." : undefined}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>{mode === "assign" ? "Assign" : "Start treatment"}</Button></>}>
      <label className="field-label" htmlFor="er-clin">Clinician (doctor)<span className="req" aria-hidden>*</span></label>
      <select id="er-clin" className="select" value={clinicianId} disabled={!list} onChange={(e) => { setClinicianId(e.target.value); setError(""); }} aria-invalid={!!error || undefined}>
        <option value="">{list ? (list.length ? "Select clinician…" : "No active doctors found") : "Loading…"}</option>
        {(list || []).map((u) => <option key={u.id} value={u.id}>{u.name}{u.position ? ` — ${u.position}` : ""}{u.department ? ` (${u.department})` : ""}</option>)}
      </select>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>
  );
}

function DispositionDialog({ visit, canAdmit, onClose }) {
  const router = useRouter();
  const options = dispositionsFrom(visit.status);
  const [dispo, setDispo] = useState(options[0]);
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  async function go() {
    if (dispo === "TRANSFERRED" && destination.trim().length < 2) { setErrors({ destination: "Enter the destination facility" }); return; }
    setBusy(true);
    try {
      await mutate(`/api/emergency/${visit.id}/disposition`, { disposition: dispo, destination, notes }, { success: `Visit closed — ${erLabel(dispo).toLowerCase()}` });
      onClose();
      if (dispo === "ADMITTED" && canAdmit) router.push(`/admissions/new?patientId=${visit.patientId}`);
      else router.refresh();
    } catch (e) { setErrors(e.fields || {}); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Record disposition" description="This closes the ER visit. It cannot be reopened."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Close visit</Button></>}>
      <div className="space-y-4">
        <fieldset>
          <legend className="field-label">Disposition<span className="req" aria-hidden>*</span></legend>
          <div className="grid gap-2" role="radiogroup">
            {options.map((d) => (
              <label key={d} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${dispo === d ? "bg-primary-soft border-primary" : "border-border hover:bg-surface-2"}`}>
                <input type="radio" name="dispo" className="checkbox mt-0.5" checked={dispo === d} onChange={() => { setDispo(d); setErrors({}); }} />
                <span><span className="font-semibold text-[13.5px] block">{erLabel(d)}</span><span className="text-xs text-muted">{DISPO_HELP[d]}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {dispo === "TRANSFERRED" && (
          <div>
            <label className="field-label" htmlFor="dispo-dest">Destination facility<span className="req" aria-hidden>*</span></label>
            <input id="dispo-dest" className="input" value={destination} onChange={(e) => setDestination(e.target.value)} aria-invalid={!!errors.destination || undefined} />
            {errors.destination && <p className="field-error" role="alert">{errors.destination}</p>}
          </div>
        )}
        <div>
          <label className="field-label" htmlFor="dispo-notes">Notes</label>
          <textarea id="dispo-notes" className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
