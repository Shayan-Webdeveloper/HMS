"use client";
import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, ShieldAlert } from "lucide-react";
import { prescriptionCreateSchema, ROUTES, FREQUENCIES, ALLERGY_CHECK_LABEL, matchAllergies } from "@/lib/validation/prescriptions";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";

const mapMedication = (m) => ({
  id: m.id,
  label: `${m.genericName} ${m.strength}`,
  sub: [m.brandName, m.dosageForm?.toLowerCase(), m.onHand != null ? `${m.onHand} in stock` : null].filter(Boolean).join(" · "),
  raw: m,
});

let rowSeq = 0;
const blankRow = () => ({ key: ++rowSeq, medication: null, dose: "", route: "Oral", frequency: "", durationDays: "", quantity: "", instructions: "" });
const fromItem = (it) => ({ key: ++rowSeq, medication: mapMedication(it.medication), dose: it.dose, route: it.route, frequency: it.frequency, durationDays: String(it.durationDays), quantity: String(it.quantity), instructions: it.instructions ?? "" });

/**
 * Create (or edit a DRAFT) prescription inside a consultation. Includes the basic allergy name
 * match, which the prescriber must explicitly acknowledge before saving.
 */
export function PrescriptionDialog({ open, onClose, encounterId, patientId, allergies, initial }) {
  const router = useRouter();
  const uid = useId();
  const [rows, setRows] = useState(() => (initial ? initial.items.map(fromItem) : [blankRow()]));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState({});
  const [serverWarnings, setServerWarnings] = useState([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const clientMatches = useMemo(() => matchAllergies(allergies, rows.filter((r) => r.medication).map((r) => r.medication.raw)), [allergies, rows]);
  const warnings = useMemo(() => {
    const seen = new Set();
    return [...clientMatches, ...serverWarnings].filter((w) => { const k = `${w.allergyId}:${w.medicationId}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [clientMatches, serverWarnings]);

  const update = (key, patch) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); setAck(false); };
  const err = (i, f) => errors[`items.${i}.${f}`];

  async function submit() {
    const payload = {
      patientId, encounterId, notes,
      items: rows.map((r) => ({ medicationId: r.medication?.id ?? "", dose: r.dose, route: r.route, frequency: r.frequency, durationDays: r.durationDays, quantity: r.quantity, instructions: r.instructions })),
      finalize: false,
    };
    const parsed = prescriptionCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const e = {};
      for (const iss of parsed.error.issues) e[iss.path.join(".")] ??= iss.message;
      setErrors(e);
      return;
    }
    setErrors({});
    if (warnings.length && !ack) { setErrors({ ack: "Acknowledge the allergy warning to continue." }); return; }
    setBusy(true);
    try {
      const body = { ...parsed.data, acknowledgeAllergies: warnings.length > 0 && ack };
      if (initial) {
        await api(`/api/prescriptions/${initial.id}`, { method: "PATCH", body: { items: body.items, notes: body.notes ?? "", acknowledgeAllergies: body.acknowledgeAllergies } });
        toast.success("Prescription updated");
      } else {
        const r = await api("/api/prescriptions", { method: "POST", body });
        toast.success(`Prescription ${r.data.prescriptionNo} saved as draft`);
      }
      onClose();
      router.refresh();
    } catch (e) {
      if (e.code === "ALLERGY_WARNING") {
        setServerWarnings(e.fields?.allergyWarnings || []);
        setAck(false);
        setErrors({ ack: "Possible allergy match found — review and acknowledge." });
      } else {
        const fe = {};
        if (e.fields) for (const [k, v] of Object.entries(e.fields)) if (typeof v === "string") fe[k] = v;
        setErrors({ ...fe, _form: e.message });
        toast.error(e.message);
      }
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title={initial ? `Edit ${initial.prescriptionNo}` : "New prescription"}
      description="Saved as a draft. It becomes active and goes to the pharmacy when the consultation is finalized."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{initial ? "Save changes" : "Save prescription"}</Button></>}>
      <div className="space-y-4">
        {allergies.length > 0 && (
          <p className="text-[12.5px] text-danger font-medium">Recorded allergies: {allergies.map((a) => a.substance).join(", ")}</p>
        )}
        {rows.map((r, i) => (
          <fieldset key={r.key} className="rounded-lg border border-border p-3 sm:p-4">
            <legend className="px-1 text-[12px] font-semibold text-muted">Medicine {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-6">
                <label className="field-label" htmlFor={`${uid}-med-${r.key}`}>Medicine<span className="req" aria-hidden>*</span></label>
                <EntityPicker id={`${uid}-med-${r.key}`} endpoint="/api/pharmacy/medications" mapItem={mapMedication} placeholder="Search formulary by generic or brand name…"
                  value={r.medication} onChange={(m) => update(r.key, { medication: m })} invalid={!!err(i, "medicationId")} />
                {err(i, "medicationId") && <p className="field-error" role="alert">Choose a medicine from the formulary</p>}
              </div>
              <Field id={`${uid}-dose-${r.key}`} label="Dose" required error={err(i, "dose")} className="sm:col-span-2">
                {(p) => <input {...p} className="input" value={r.dose} onChange={(e) => update(r.key, { dose: e.target.value })} placeholder="e.g. 1 tablet" maxLength={60} />}
              </Field>
              <Field id={`${uid}-route-${r.key}`} label="Route" required error={err(i, "route")} className="sm:col-span-2">
                {(p) => <select {...p} className="select" value={r.route} onChange={(e) => update(r.key, { route: e.target.value })}>{ROUTES.map((x) => <option key={x}>{x}</option>)}</select>}
              </Field>
              <Field id={`${uid}-freq-${r.key}`} label="Frequency" required error={err(i, "frequency")} className="sm:col-span-2">
                {(p) => <><input {...p} className="input" list={`${uid}-freqs`} value={r.frequency} onChange={(e) => update(r.key, { frequency: e.target.value })} maxLength={60} /></>}
              </Field>
              <Field id={`${uid}-dur-${r.key}`} label="Duration (days)" required error={err(i, "durationDays")} className="sm:col-span-2">
                {(p) => <input {...p} className="input" type="number" min={1} max={365} inputMode="numeric" value={r.durationDays} onChange={(e) => update(r.key, { durationDays: e.target.value })} />}
              </Field>
              <Field id={`${uid}-qty-${r.key}`} label="Quantity to dispense" required error={err(i, "quantity")} className="sm:col-span-2">
                {(p) => <input {...p} className="input" type="number" min={1} inputMode="numeric" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />}
              </Field>
              <Field id={`${uid}-ins-${r.key}`} label="Instructions" error={err(i, "instructions")} className="sm:col-span-2">
                {(p) => <input {...p} className="input" value={r.instructions} onChange={(e) => update(r.key, { instructions: e.target.value })} placeholder="e.g. After meals" maxLength={300} />}
              </Field>
            </div>
            {rows.length > 1 && (
              <div className="mt-3 flex justify-end"><Button size="sm" variant="ghost" icon={Trash2} onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setAck(false); }}>Remove</Button></div>
            )}
          </fieldset>
        ))}
        <datalist id={`${uid}-freqs`}>{FREQUENCIES.map((f) => <option key={f} value={f} />)}</datalist>
        {errors.items && <p className="field-error" role="alert">{errors.items}</p>}
        {rows.length < 20 && <Button size="sm" icon={Plus} onClick={() => setRows((rs) => [...rs, blankRow()])}>Add another medicine</Button>}

        <div>
          <label className="field-label" htmlFor={`${uid}-notes`}>Notes for pharmacy (optional)</label>
          <textarea id={`${uid}-notes`} className="textarea" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {warnings.length > 0 && (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-4">
            <p className="font-semibold text-danger flex items-center gap-2"><ShieldAlert size={16} aria-hidden /> Possible allergy match</p>
            <ul className="mt-2 space-y-1 text-[13px] text-ink">
              {warnings.map((w) => (
                <li key={`${w.allergyId}:${w.medicationId}`}>
                  <span className="font-semibold">{w.medicationName}</span> matches recorded allergy <span className="font-semibold text-danger">“{w.substance}”</span>
                  {w.severity && w.severity !== "UNKNOWN" ? ` (${w.severity.toLowerCase()})` : ""} <span className="text-muted">— matched on {w.matchedOn === "genericName" ? "generic name" : w.matchedOn === "brandName" ? "brand name" : "category"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-muted italic">{ALLERGY_CHECK_LABEL}.</p>
            <label className="mt-3 flex items-start gap-2 text-[13px] font-medium cursor-pointer">
              <input type="checkbox" className="checkbox mt-0.5" checked={ack} onChange={(e) => { setAck(e.target.checked); setErrors((x) => ({ ...x, ack: undefined })); }} />
              I have reviewed these allergy matches and want to prescribe anyway.
            </label>
            {errors.ack && <p className="field-error" role="alert">{errors.ack}</p>}
          </div>
        )}
        {warnings.length === 0 && <p className="text-[12px] text-subtle">Allergy screening here is a {ALLERGY_CHECK_LABEL.charAt(0).toLowerCase() + ALLERGY_CHECK_LABEL.slice(1)}.</p>}
        {errors._form && <p className="field-error" role="alert">{errors._form}</p>}
      </div>
    </Modal>
  );
}

function Field({ id, label, required, error, className, children }) {
  return (
    <div className={className}>
      <label className="field-label" htmlFor={id}>{label}{required && <span className="req" aria-hidden>*</span>}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-err` : undefined })}
      {error && <p id={`${id}-err`} className="field-error" role="alert">{error}</p>}
    </div>
  );
}
