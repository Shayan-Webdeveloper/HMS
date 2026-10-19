"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, FilePen } from "lucide-react";
import { noteSchema, amendSchema } from "@/lib/validation/encounters";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextareaField, SelectField } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";

/** Append-only clinical notes on a DRAFT consultation. */
export function NotesPanel({ encounterId, notes, canAdd }) {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(noteSchema), defaultValues: { kind: "GENERAL", content: "" } });
  async function onSubmit(v) {
    try {
      await api(`/api/encounters/${encounterId}/notes`, { method: "POST", body: v });
      toast.success("Note added");
      form.reset({ kind: v.kind, content: "" });
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  return (
    <div>
      {notes.length === 0 ? <p className="text-[13px] text-muted">No additional notes.</p> : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-surface-2 border border-border px-3 py-2">
              <p className="text-xs text-muted"><Badge tone="neutral" plain className="mr-1.5">{n.kind === "PROGRESS" ? "Progress" : "Note"}</Badge>{n.authorName} · {n.createdLabel}</p>
              <p className="text-[13.5px] mt-1 whitespace-pre-wrap">{n.content}</p>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 pt-4 border-t border-border grid gap-3 sm:grid-cols-[160px_1fr]" noValidate>
          <SelectField form={form} name="kind" label="Type" options={[{ value: "GENERAL", label: "General note" }, { value: "PROGRESS", label: "Progress note" }]} />
          <TextareaField form={form} name="content" label="Note" rows={2} />
          <div className="sm:col-span-2 flex justify-end"><Button type="submit" size="sm" icon={Plus} loading={form.formState.isSubmitting}>Add note</Button></div>
        </form>
      )}
    </div>
  );
}

/** Amendment history for a FINALIZED consultation; new amendments never overwrite the signed record. */
export function AmendmentPanel({ encounterId, amendments, canAmend }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(amendSchema), defaultValues: { content: "", reason: "" } });
  function close() { setOpen(false); form.reset(); }
  async function onSubmit(v) {
    try {
      await api(`/api/encounters/${encounterId}/amend`, { method: "POST", body: v });
      toast.success("Amendment recorded");
      close(); router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  return (
    <div>
      {amendments.length === 0 ? <p className="text-[13px] text-muted">No amendments. The signed record is unchanged.</p> : (
        <ol className="timeline">
          {amendments.map((n) => (
            <li key={n.id} className="timeline-item">
              <p className="text-xs text-muted"><span className="font-semibold text-ink">{n.authorName}</span> · {n.createdLabel}</p>
              <p className="text-[12.5px] text-warning font-medium mt-0.5">Reason: {n.reason}</p>
              <p className="text-[13.5px] mt-1 whitespace-pre-wrap">{n.content}</p>
            </li>
          ))}
        </ol>
      )}
      {canAmend && <Button size="sm" icon={FilePen} className="mt-3" onClick={() => setOpen(true)}>Add amendment</Button>}
      <Modal open={open} onClose={close} title="Amend consultation" description="Amendments are permanent, time-stamped and attributed to you. The original signed note is kept unchanged."
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Record amendment</Button></>}>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <TextareaField form={form} name="content" label="Amendment" required rows={5} />
          <TextareaField form={form} name="reason" label="Reason for amendment" required rows={2} hint="e.g. Corrected examination finding recorded in error" />
        </form>
      </Modal>
    </div>
  );
}
