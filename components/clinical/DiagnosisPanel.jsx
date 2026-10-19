"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, Star } from "lucide-react";
import { diagnosisSchema } from "@/lib/validation/encounters";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { TextField, CheckboxField } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";

/** Clinician-entered diagnoses. The system never suggests codes or diagnoses. */
export function DiagnosisPanel({ encounterId, diagnoses, canEdit }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(null);
  const form = useForm({ resolver: zodResolver(diagnosisSchema), defaultValues: { code: "", description: "", isPrimary: diagnoses.length === 0 } });

  async function add(v) {
    try {
      await mutate(`/api/encounters/${encounterId}/diagnoses`, v, { success: "Diagnosis added", form });
      form.reset({ code: "", description: "", isPrimary: false });
      router.refresh();
    } catch {}
  }
  async function remove(id) {
    setRemoving(id);
    try { await mutate(`/api/encounters/${encounterId}/diagnoses/${id}`, undefined, { method: "DELETE", success: "Diagnosis removed" }); router.refresh(); } catch {} finally { setRemoving(null); }
  }

  return (
    <div>
      {diagnoses.length === 0 ? (
        <p className="text-[13px] text-muted">No diagnosis recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border -my-2">
          {diagnoses.map((d) => (
            <li key={d.id} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">
                  {d.code && <span className="font-mono text-[12.5px] text-primary-ink bg-primary-soft rounded px-1.5 py-0.5 mr-2">{d.code}</span>}
                  {d.description}
                </p>
                {d.isPrimary && <Badge tone="primary" plain className="mt-1"><Star size={11} aria-hidden /> Primary</Badge>}
              </div>
              {canEdit && (
                <Button size="sm" variant="ghost" iconOnly icon={Trash2} loading={removing === d.id} onClick={() => remove(d.id)} aria-label={`Remove diagnosis ${d.description}`} />
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={form.handleSubmit(add)} className="mt-4 pt-4 border-t border-border grid gap-3 sm:grid-cols-[130px_1fr]" noValidate>
          <TextField form={form} name="code" label="Code (optional)" placeholder="e.g. J06.9" autoComplete="off" />
          <TextField form={form} name="description" label="Diagnosis" required placeholder="As written by the clinician" autoComplete="off" />
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
            <CheckboxField form={form} name="isPrimary" label="Primary diagnosis" />
            <Button type="submit" size="sm" variant="primary" icon={Plus} loading={form.formState.isSubmitting}>Add diagnosis</Button>
          </div>
        </form>
      )}
    </div>
  );
}
