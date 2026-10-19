"use client";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save } from "lucide-react";
import { imagingReportSchema } from "@/lib/validation/radiology";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { TextareaField } from "@/components/ui/Form";

export function ReportForm({ studyId, report, status }) {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(imagingReportSchema), defaultValues: { findings: report?.findings ?? "", impression: report?.impression ?? "" } });
  async function submit(values) {
    try {
      await mutate(`/api/radiology/studies/${studyId}/report`, values, { success: report ? "Report updated" : "Report saved: awaiting verification", form });
      form.reset(values);
      router.refresh();
    } catch { /* handled */ }
  }
  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
      <TextareaField form={form} name="findings" label="Findings" required rows={8} />
      <TextareaField form={form} name="impression" label="Impression" required rows={3} hint="The radiologist's conclusion, as written by the reporting clinician." />
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border">
        <p className="text-xs text-muted">{status === "REPORTED" ? "Edits are allowed until the report is verified." : "Saving moves the study to “awaiting verification”."}</p>
        <Button type="submit" variant="primary" icon={Save} loading={form.formState.isSubmitting} disabled={status === "REPORTED" && !form.formState.isDirty}>{report ? "Update report" : "Save report"}</Button>
      </div>
    </form>
  );
}
