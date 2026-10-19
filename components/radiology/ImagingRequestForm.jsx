"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ScanLine } from "lucide-react";
import { imagingRequestSchema, modalityLabel } from "@/lib/validation/radiology";
import { api, handleFormError } from "@/components/ui/api-client";
import { formatMoney } from "@/lib/utils/money";
import { Button } from "@/components/ui/Button";
import { FormField, TextareaField } from "@/components/ui/Form";
import { PatientSelector } from "@/components/ui/EntityPicker";

export function ImagingRequestForm({ catalog, initialPatient = null, encounter = null, currency = "PKR" }) {
  const router = useRouter();
  const [patient, setPatient] = useState(initialPatient);
  const form = useForm({
    resolver: zodResolver(imagingRequestSchema),
    defaultValues: { patientId: initialPatient?.id ?? "", encounterId: encounter?.id ?? "", catalogCode: "", indication: "" },
  });
  const errors = form.formState.errors;
  const code = useWatch({ control: form.control, name: "catalogCode" });
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of catalog) { if (!m.has(c.modality)) m.set(c.modality, []); m.get(c.modality).push(c); }
    return [...m.entries()];
  }, [catalog]);
  const chosen = catalog.find((c) => c.code === code);

  async function submit(values) {
    try {
      const r = await api("/api/radiology/studies", { method: "POST", body: values });
      toast.success(`Imaging request ${r.data.studyNo} created`);
      router.push(`/radiology/${r.data.id}`);
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
      <section className="card card-body space-y-5 min-w-0">
        <FormField label="Patient" required error={errors.patientId ? "Select a patient" : undefined}>
          {(a) => <PatientSelector value={patient} disabled={!!encounter} id={a.id} invalid={a["aria-invalid"]} describedBy={a["aria-describedby"]}
            onChange={(p) => { setPatient(p); form.setValue("patientId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted }); }} />}
        </FormField>
        {encounter && <p className="text-[13px] text-muted -mt-2">Linked to encounter <span className="font-mono font-semibold text-ink">{encounter.encounterNo}</span>.</p>}
        <FormField label="Examination" required error={errors.catalogCode?.message}>
          {(a) => (
            <select className="select" {...a} {...form.register("catalogCode")}>
              <option value="">Choose an examination…</option>
              {groups.map(([mod, items]) => (
                <optgroup key={mod} label={modalityLabel(mod)}>
                  {items.map((c) => <option key={c.code} value={c.code}>{c.bodyPart} ({c.code})</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </FormField>
        <TextareaField form={form} name="indication" label="Clinical indication" rows={4}
          hint="The clinical question for the radiologist, relevant history, contrast allergies or pregnancy status." />
      </section>
      <aside className="card lg:sticky lg:top-[76px]">
        <header className="card-header"><h2 className="card-title">Request summary</h2></header>
        <div className="card-body space-y-4">
          {chosen ? (
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between gap-2"><dt className="text-muted">Modality</dt><dd className="font-medium">{modalityLabel(chosen.modality)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Examination</dt><dd className="font-medium text-right">{chosen.bodyPart}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Code</dt><dd className="font-mono">{chosen.code}</dd></div>
              <div className="flex justify-between gap-2 border-t border-border pt-2"><dt className="text-muted">Charge</dt><dd className="font-bold tabular text-[15px]">{formatMoney(chosen.price, currency)}</dd></div>
            </dl>
          ) : (
            <div className="text-center py-3"><ScanLine size={22} className="mx-auto text-subtle" aria-hidden /><p className="text-[13px] text-muted mt-2">Choose an examination.</p></div>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>Submit imaging request</Button>
          <p className="text-[11.5px] text-subtle">Radiology is notified to schedule the study. The charge is captured at request time.</p>
        </div>
      </aside>
    </form>
  );
}
