"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilLine } from "lucide-react";
import { correctionSchema, flagForResult, describeReference } from "@/lib/validation/lab";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { TextField, TextareaField } from "@/components/ui/Form";

/** Post-validation correction: creates a new result row; the previous row is retained with the reason. */
export function CorrectResultButton({ orderId, item, released }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(correctionSchema),
    defaultValues: { orderItemId: item.id, value: item.current.value, unit: item.current.unit ?? item.test.unit ?? "", comment: item.current.comment ?? "", reason: "" },
  });
  const value = useWatch({ control: form.control, name: "value" });
  const unit = useWatch({ control: form.control, name: "unit" });
  const flag = value?.trim() ? flagForResult(item.test, value, unit) : null;

  async function submit(values) {
    try {
      await mutate(`/api/lab/orders/${orderId}/correct`, values, { success: "Correction saved: re-validation required", form });
      setOpen(false);
      form.reset({ ...values, reason: "" });
      router.refresh();
    } catch { /* handled */ }
  }

  return (
    <>
      <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setOpen(true)} aria-label={`Correct result for ${item.test.name}`}>Correct</Button>
      <Modal open={open} onClose={() => !form.formState.isSubmitting && setOpen(false)} title={`Correct result: ${item.test.name}`}
        description={released
          ? "The released result will be withdrawn until the correction is validated. The original value is kept in the audit history."
          : "The original value is kept in the audit history. The correction must be validated before release."}
        footer={<><Button onClick={() => setOpen(false)} disabled={form.formState.isSubmitting}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Save correction</Button></>}>
        <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
          <div className="rounded-lg bg-surface-2 border border-border px-3 py-2 text-[13px]">
            Current value: <span className="font-semibold tabular">{item.current.value}</span> {item.current.unit}
            {item.current.flag && <span className="ml-2"><StatusBadge status={item.current.flag} /></span>}
            <span className="block text-xs text-muted mt-0.5">Reference: {describeReference(item.test) || "not configured"}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px] gap-3">
            <TextField form={form} name="value" label="Corrected value" required autoComplete="off" />
            <TextField form={form} name="unit" label="Unit" />
          </div>
          {flag && <p className="text-xs text-muted">New flag (configured range): <StatusBadge status={flag} /></p>}
          <TextField form={form} name="comment" label="Comment" />
          <TextareaField form={form} name="reason" label="Reason for correction" required rows={2} hint="e.g. transcription error, analyser re-run after QC failure" />
        </form>
      </Modal>
    </>
  );
}
