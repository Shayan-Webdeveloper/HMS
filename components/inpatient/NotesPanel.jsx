"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { NotebookPen, Lock } from "lucide-react";
import { noteSchema } from "@/lib/validation/inpatient";
import { mutate } from "@/components/ui/api-client";
import { formatDateTime } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SelectField, TextareaField } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/States";

const KIND = { PROGRESS: { label: "Progress note", tone: "primary" }, ROUND: { label: "Ward round", tone: "teal" }, NURSING: { label: "Nursing note", tone: "info" } };

export function NotesPanel({ admissionId, notes, canNursing, canClinician, isOpen, tz }) {
  const router = useRouter();
  const [filter, setFilter] = useState("ALL");
  const kinds = [canClinician && "PROGRESS", canClinician && "ROUND", canNursing && "NURSING"].filter(Boolean);
  const form = useForm({ resolver: zodResolver(noteSchema), defaultValues: { kind: kinds[0] || "NURSING", content: "" } });
  const shown = notes.filter((n) => filter === "ALL" || (filter === "DOCTOR" ? ["PROGRESS", "ROUND"].includes(n.kind) : n.kind === filter));

  async function submit(values) {
    try {
      await mutate(`/api/admissions/${admissionId}/notes`, values, { success: "Note added", form });
      form.reset({ kind: values.kind, content: "" });
      router.refresh();
    } catch { /* handled */ }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border" role="group" aria-label="Filter notes">
          {[["ALL", "All"], ["DOCTOR", "Doctor notes"], ["NURSING", "Nursing"]].map(([k, l]) => (
            <button key={k} type="button" className={`btn btn-sm ${filter === k ? "btn-primary" : "btn-secondary"}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
          <span className="ml-auto text-xs text-subtle inline-flex items-center gap-1"><Lock size={12} aria-hidden /> Notes are append-only</span>
        </div>
        {shown.length === 0 ? <EmptyState icon={NotebookPen} title="No notes yet" description="Progress, ward-round and nursing notes appear here, newest first." /> : (
          <ol className="divide-y divide-border">
            {shown.map((n) => (
              <li key={n.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <Badge tone={KIND[n.kind]?.tone || "neutral"} plain>{KIND[n.kind]?.label || n.kind}</Badge>
                  <span className="text-[12.5px] font-medium">{n.authorName}</span>
                  <span className="text-xs text-subtle">{formatDateTime(n.createdAt, tz)}</span>
                </div>
                <p className="text-[13.5px] whitespace-pre-wrap break-words">{n.content}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
      <aside className="border-t lg:border-t-0 lg:border-l border-border p-5">
        <h3 className="font-semibold text-[13.5px] mb-3">Add note</h3>
        {!isOpen ? <p className="text-[13px] text-muted">This admission is closed; no further notes can be added.</p>
          : kinds.length === 0 ? <p className="text-[13px] text-muted">Your role cannot add inpatient notes.</p> : (
            <form className="space-y-3" onSubmit={form.handleSubmit(submit)} noValidate>
              <SelectField form={form} name="kind" label="Type" options={kinds.map((k) => ({ value: k, label: KIND[k].label }))} />
              <TextareaField form={form} name="content" label="Note" required rows={7} />
              <Button type="submit" variant="primary" loading={form.formState.isSubmitting} className="w-full">Add note</Button>
            </form>
          )}
      </aside>
    </div>
  );
}
