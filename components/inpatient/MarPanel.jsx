"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pill, Plus } from "lucide-react";
import { marSchema, MAR_STATUSES } from "@/lib/validation/inpatient";
import { mutate } from "@/components/ui/api-client";
import { formatDateTime } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { SelectField, TextField, TextareaField } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";

const TONE = { GIVEN: "success", HELD: "warning", REFUSED: "danger" };

export function MarPanel({ admissionId, administrations, items, canRecord, isOpen, tz }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-border">
        <p className="text-[13px] text-muted">{items.length} active prescription item{items.length === 1 ? "" : "s"} · {administrations.length} administration record{administrations.length === 1 ? "" : "s"}</p>
        {canRecord && isOpen && <Button size="sm" variant="primary" icon={Plus} onClick={() => setOpen(true)}>Record administration</Button>}
      </div>
      {items.length > 0 && (
        <div className="px-5 py-3 border-b border-border bg-surface-2">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted mb-2">Active prescriptions</p>
          <ul className="grid sm:grid-cols-2 gap-2">
            {items.map((i) => (
              <li key={i.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px]">
                <p className="font-medium">{i.label}</p>
                <p className="text-muted text-xs">{i.dose} · {i.route} · {i.frequency} × {i.durationDays} d · {i.prescription.prescriptionNo}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {administrations.length === 0 ? <EmptyState icon={Pill} title="No administrations recorded" description="Doses given, held or refused are recorded here by nursing staff." /> : (
        <div className="table-wrap">
          <table className="table table-responsive">
            <caption className="sr-only">Medication administration record</caption>
            <thead><tr><th>Time</th><th>Medication</th><th>Dose</th><th>Status</th><th>Note</th><th>By</th></tr></thead>
            <tbody>
              {administrations.map((a) => (
                <tr key={a.id}>
                  <td data-label="Time">{formatDateTime(a.administeredAt, tz)}</td>
                  <td data-label="Medication"><span className="font-medium">{a.medicationName}</span>{!a.prescriptionItemId && <Badge tone="neutral" plain className="ml-2">Unlisted</Badge>}</td>
                  <td data-label="Dose">{a.dose}</td>
                  <td data-label="Status"><Badge tone={TONE[a.status] || "neutral"}>{a.status.toLowerCase()}</Badge></td>
                  <td data-label="Note" className="max-w-[280px]">{a.note || "—"}</td>
                  <td data-label="By">{a.administeredByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <MarDialog admissionId={admissionId} items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}

function MarDialog({ admissionId, items, onClose }) {
  const router = useRouter();
  const [source, setSource] = useState(items.length ? "ITEM" : "FREE");
  const form = useForm({ resolver: zodResolver(marSchema), defaultValues: { prescriptionItemId: items[0]?.id ?? "", medicationName: "", dose: items[0]?.dose ?? "", status: "GIVEN", note: "" } });
  const status = useWatch({ control: form.control, name: "status" });

  function pickSource(s) {
    setSource(s);
    if (s === "FREE") { form.setValue("prescriptionItemId", ""); form.setValue("dose", ""); }
    else { form.setValue("prescriptionItemId", items[0]?.id ?? ""); form.setValue("dose", items[0]?.dose ?? ""); form.setValue("medicationName", ""); }
  }
  async function submit(values) {
    const body = source === "ITEM" ? { ...values, medicationName: undefined } : { ...values, prescriptionItemId: undefined };
    try { await mutate(`/api/admissions/${admissionId}/medications`, body, { success: "Administration recorded", form }); onClose(); router.refresh(); } catch { /* handled */ }
  }
  const itemReg = form.register("prescriptionItemId");

  return (
    <Modal open onClose={onClose} title="Record medication administration" size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Save record</Button></>}>
      <form className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
        <div role="radiogroup" aria-label="Medication source" className="flex flex-wrap gap-2">
          <label className={`btn btn-sm ${source === "ITEM" ? "btn-primary" : "btn-secondary"} ${!items.length ? "opacity-50" : ""}`}>
            <input type="radio" className="sr-only" name="mar-source" checked={source === "ITEM"} disabled={!items.length} onChange={() => pickSource("ITEM")} /> From active prescription
          </label>
          <label className={`btn btn-sm ${source === "FREE" ? "btn-primary" : "btn-secondary"}`}>
            <input type="radio" className="sr-only" name="mar-source" checked={source === "FREE"} onChange={() => pickSource("FREE")} /> Other (free text)
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {source === "ITEM" ? (
            <SelectField form={form} name="prescriptionItemId" label="Prescribed item" required className="sm:col-span-2"
              options={items.map((i) => ({ value: i.id, label: `${i.label} — ${i.dose}, ${i.route}, ${i.frequency} (${i.prescription.prescriptionNo})` }))}
              onChange={(e) => { itemReg.onChange(e); const it = items.find((x) => x.id === e.target.value); if (it) form.setValue("dose", it.dose); }} />
          ) : (
            <TextField form={form} name="medicationName" label="Medication" required className="sm:col-span-2" placeholder="Name and strength" />
          )}
          <TextField form={form} name="dose" label="Dose given" required />
          <SelectField form={form} name="status" label="Status" options={MAR_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
          <TextareaField form={form} name="note" label={status === "GIVEN" ? "Note" : "Reason"} required={status !== "GIVEN"} rows={2} className="sm:col-span-2" />
        </div>
        <button type="submit" className="sr-only">Save</button>
      </form>
    </Modal>
  );
}
