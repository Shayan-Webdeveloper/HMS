"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Search, X, Clock, FlaskConical, Siren, AlertTriangle } from "lucide-react";
import { labOrderSchema, LAB_PRIORITIES, formatReferenceRange } from "@/lib/validation/lab";
import { api, handleFormError } from "@/components/ui/api-client";
import { D, formatMoney } from "@/lib/utils/money";
import { Button } from "@/components/ui/Button";
import { FormField, TextareaField } from "@/components/ui/Form";
import { PatientSelector } from "@/components/ui/EntityPicker";
import { cn } from "@/lib/utils/cn";

const PRIORITY_INFO = {
  ROUTINE: { label: "Routine", hint: "Standard turnaround" },
  URGENT: { label: "Urgent", hint: "Processed ahead of routine work" },
  STAT: { label: "STAT", hint: "Immediate: life-threatening situations only" },
};

export function LabOrderForm({ tests, initialPatient = null, encounter = null, currency = "PKR" }) {
  const router = useRouter();
  const [patient, setPatient] = useState(initialPatient);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const form = useForm({
    resolver: zodResolver(labOrderSchema),
    defaultValues: { patientId: initialPatient?.id ?? "", encounterId: encounter?.id ?? "", testIds: [], priority: "ROUTINE", clinicalNotes: "" },
  });
  const selectedIds = useWatch({ control: form.control, name: "testIds" });
  const priority = useWatch({ control: form.control, name: "priority" });
  const errors = form.formState.errors;

  const byId = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  const categories = useMemo(() => [...new Set(tests.map((t) => t.category))], [tests]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return tests.filter((t) => (!category || t.category === category) && (!s || `${t.code} ${t.name} ${t.category} ${t.specimenType}`.toLowerCase().includes(s)));
  }, [tests, search, category]);
  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean);
  const total = selected.reduce((sum, t) => sum.plus(D(t.price)), D(0));
  const specimenTypes = [...new Set(selected.map((t) => t.specimenType))];

  function toggle(id) {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    form.setValue("testIds", next, { shouldValidate: form.formState.isSubmitted });
  }
  function choosePatient(p) {
    setPatient(p);
    form.setValue("patientId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted });
  }

  async function submit(values) {
    try {
      const r = await api("/api/lab/orders", { method: "POST", body: values });
      toast.success(`Lab order ${r.data.orderNo} placed`);
      router.push(`/laboratory/${r.data.id}`);
      router.refresh();
    } catch (e) {
      handleFormError(e, form);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        <section className="card card-body space-y-4">
          <h2 className="card-title">Patient</h2>
          <FormField label="Patient" required error={errors.patientId?.message ? "Select a patient" : undefined}>
            {(a) => <PatientSelector value={patient} onChange={choosePatient} id={a.id} invalid={a["aria-invalid"]} describedBy={a["aria-describedby"]} disabled={!!encounter} />}
          </FormField>
          {encounter && (
            <p className="text-[13px] text-muted">Linked to encounter <span className="font-mono font-semibold text-ink">{encounter.encounterNo}</span>. The order will appear on that consultation.</p>
          )}
        </section>

        <section className="card">
          <header className="card-header flex-col items-stretch sm:flex-row sm:items-center">
            <div>
              <h2 className="card-title">Tests</h2>
              <p className="text-xs text-muted mt-0.5">{tests.length} active tests in the catalogue</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:w-auto w-full">
              <div className="relative sm:w-64">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
                <input type="search" className="input pl-9" placeholder="Search tests…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tests" />
              </div>
              <select className="select sm:w-48" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </header>
          {errors.testIds?.message && <p className="field-error px-4 pt-3" role="alert">{errors.testIds.message}</p>}
          <ul className="max-h-[440px] overflow-y-auto divide-y divide-border" aria-label="Available tests">
            {filtered.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">No tests match your search.</li>}
            {filtered.map((t) => {
              const on = selectedIds.includes(t.id);
              const range = formatReferenceRange(t);
              return (
                <li key={t.id}>
                  <label className={cn("flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors", on ? "bg-primary-soft/60" : "hover:bg-surface-2")}>
                    <input type="checkbox" className="checkbox mt-0.5" checked={on} onChange={() => toggle(t.id)} />
                    <span className="flex-1 min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-[13.5px]">{t.name}</span>
                        <span className="font-mono text-[11.5px] text-subtle">{t.code}</span>
                      </span>
                      <span className="block text-xs text-muted mt-0.5">
                        {t.category} · {t.specimenType}{range ? ` · Ref ${range}${t.unit ? ` ${t.unit}` : ""}` : ""}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-[13px] font-semibold tabular">{formatMoney(t.price, currency)}</span>
                      <span className="text-[11.5px] text-subtle inline-flex items-center gap-1"><Clock size={11} aria-hidden />{t.turnaroundHours} h</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card card-body space-y-4">
          <fieldset>
            <legend className="field-label">Priority<span className="req" aria-hidden>*</span></legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {LAB_PRIORITIES.map((p) => (
                <label key={p} className={cn("rounded-lg border px-3 py-2.5 cursor-pointer flex items-start gap-2.5 transition-colors",
                  priority === p ? (p === "STAT" ? "border-danger bg-danger-soft" : p === "URGENT" ? "border-warning bg-warning-soft" : "border-primary bg-primary-soft") : "border-border hover:bg-surface-2")}>
                  <input type="radio" value={p} {...form.register("priority")} className="mt-1 accent-[var(--color-primary)]" />
                  <span>
                    <span className="font-semibold text-[13.5px] flex items-center gap-1">{p === "STAT" && <Siren size={13} className="text-danger" aria-hidden />}{PRIORITY_INFO[p].label}</span>
                    <span className="block text-xs text-muted">{PRIORITY_INFO[p].hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <TextareaField form={form} name="clinicalNotes" label="Clinical notes for the laboratory" rows={3}
            hint="Relevant history, current medication or fasting status. Visible to laboratory staff." />
        </section>
      </div>

      <aside className="card lg:sticky lg:top-[76px]">
        <header className="card-header"><h2 className="card-title">Order summary</h2><span className="text-xs text-muted tabular">{selected.length} test{selected.length === 1 ? "" : "s"}</span></header>
        <div className="card-body space-y-4">
          {selected.length === 0 ? (
            <div className="text-center py-4">
              <FlaskConical size={22} className="mx-auto text-subtle" aria-hidden />
              <p className="text-[13px] text-muted mt-2">Select one or more tests.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {selected.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-2 text-[13px]">
                  <span className="min-w-0"><span className="font-medium">{t.name}</span><span className="block text-xs text-subtle">{t.specimenType}</span></span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="tabular">{formatMoney(t.price, currency)}</span>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => toggle(t.id)} aria-label={`Remove ${t.name}`}><X size={14} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {specimenTypes.length > 0 && (
            <div className="rounded-lg bg-surface-2 border border-border px-3 py-2 text-xs text-muted">
              <span className="font-semibold text-ink">Specimens:</span> {specimenTypes.join(", ")}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-[13px] text-muted">Estimated charges</span>
            <span className="text-[17px] font-bold tabular">{formatMoney(total.toFixed(2), currency)}</span>
          </div>
          {priority === "STAT" && (
            <p className="text-xs text-danger flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />STAT orders alert the laboratory immediately.</p>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>Place lab order</Button>
          <p className="text-[11.5px] text-subtle">Prices are captured at the time of ordering for billing.</p>
        </div>
      </aside>
    </form>
  );
}
