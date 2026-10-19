"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Save, PenLine, CheckCircle2, Circle, CalendarPlus } from "lucide-react";
import { encounterUpdateSchema, SOAP_FIELDS, SOAP_LABELS } from "@/lib/validation/encounters";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, TextareaField } from "@/components/ui/Form";

const ROWS = { chiefComplaint: 2, historyOfPresentIllness: 4, examination: 4, assessment: 3, plan: 4 };
const HINTS = {
  assessment: "Your clinical assessment. Required before finalizing.",
  plan: "Management plan, advice and follow-up instructions.",
};

/**
 * Structured SOAP documentation with explicit "Save draft" and "Finalize & sign".
 * Nothing is auto-generated: every field is typed by the clinician.
 */
export function EncounterDocumentation({ encounter, canFinalize, diagnosesCount, draftRxCount, today, bookFollowUpHref }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const defaults = Object.fromEntries([...SOAP_FIELDS.map((k) => [k, encounter[k] ?? ""]), ["followUpDate", encounter.followUpDate ? encounter.followUpDate.slice(0, 10) : ""]]);
  const form = useForm({ resolver: zodResolver(encounterUpdateSchema), defaultValues: defaults });
  const { isDirty, isSubmitting } = form.formState;
  const [assessment, followUp] = useWatch({ control: form.control, name: ["assessment", "followUpDate"] });

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  async function save(values, { quiet } = {}) {
    const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v ?? ""]));
    await api(`/api/encounters/${encounter.id}`, { method: "PATCH", body });
    form.reset(Object.fromEntries(Object.entries(body)));
    if (!quiet) toast.success("Draft saved");
    router.refresh();
  }
  const onSave = form.handleSubmit(async (v) => { try { await save(v); } catch (e) { handleFormError(e, form); } });

  async function finalize() {
    try {
      if (isDirty) {
        let ok = true;
        await form.handleSubmit(async (v) => { await save(v, { quiet: true }); }, () => { ok = false; })();
        if (!ok) { setConfirm(false); toast.error("Fix the highlighted fields before finalizing."); return; }
      }
      const r = await api(`/api/encounters/${encounter.id}/finalize`, { method: "POST" });
      const n = r.data.prescriptionsIssued?.length || 0;
      toast.success(n ? `Consultation finalized — ${n} prescription${n > 1 ? "s" : ""} sent to pharmacy` : "Consultation finalized");
      setConfirm(false);
      router.refresh();
    } catch (e) {
      setConfirm(false);
      handleFormError(e, form);
    }
  }

  const hasAssessment = !!(assessment && assessment.trim());
  const ready = hasAssessment && diagnosesCount > 0;
  return (
    <form onSubmit={onSave} noValidate className="space-y-4">
      {SOAP_FIELDS.map((k) => (
        k === "chiefComplaint"
          ? <TextField key={k} form={form} name={k} label={SOAP_LABELS[k]} maxLength={500} />
          : <TextareaField key={k} form={form} name={k} label={SOAP_LABELS[k]} rows={ROWS[k]} hint={HINTS[k]} required={k === "assessment"} />
      ))}
      <div className="grid sm:grid-cols-[220px_1fr] gap-3 items-end">
        <TextField form={form} name="followUpDate" label="Follow-up date" type="date" min={today} />
        {followUp && bookFollowUpHref && !isDirty && (
          <Button href={`${bookFollowUpHref}&date=${followUp}`} icon={CalendarPlus} variant="ghost" className="justify-self-start">Book follow-up appointment</Button>
        )}
      </div>

      <div className="flex flex-col gap-3 pt-4 border-t border-border sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[12.5px] space-y-1" aria-live="polite">
          <p className={isDirty ? "text-warning font-semibold" : "text-muted"}>{isDirty ? "Unsaved changes" : "All changes saved"}</p>
          {canFinalize && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
              <li className="inline-flex items-center gap-1">{hasAssessment ? <CheckCircle2 size={13} className="text-success" aria-hidden /> : <Circle size={13} aria-hidden />}Assessment</li>
              <li className="inline-flex items-center gap-1">{diagnosesCount > 0 ? <CheckCircle2 size={13} className="text-success" aria-hidden /> : <Circle size={13} aria-hidden />}At least one diagnosis</li>
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" icon={Save} loading={isSubmitting} disabled={!isDirty}>Save draft</Button>
          {canFinalize && <Button variant="success" icon={PenLine} onClick={() => setConfirm(true)} disabled={!ready} title={ready ? undefined : "Add an assessment and at least one diagnosis first"}>Finalize &amp; sign</Button>}
        </div>
      </div>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="primary" title="Finalize this consultation?" confirmLabel="Finalize & sign"
        message={`${isDirty ? "Your unsaved changes will be saved first. " : ""}Once finalized the record is read-only (corrections are added as amendments)${draftRxCount ? `, ${draftRxCount} draft prescription${draftRxCount > 1 ? "s" : ""} become${draftRxCount > 1 ? "" : "s"} active and are sent to the pharmacy` : ""} and the appointment is completed.`}
        onConfirm={finalize} />
    </form>
  );
}
