"use client";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { wardSchema, WARD_TYPES } from "@/lib/validation/inpatient";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { TextField, SelectField, CheckboxField, FormSection } from "@/components/ui/Form";

const label = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export function WardForm({ ward, departments, onSaved, cancelHref = "/wards" }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(wardSchema),
    defaultValues: {
      name: ward?.name ?? "", code: ward?.code ?? "", type: ward?.type ?? "GENERAL",
      dailyRate: ward?.dailyRate ?? "", departmentId: ward?.departmentId ?? "", isActive: ward?.isActive ?? true,
    },
  });

  async function submit(values) {
    try {
      const r = await mutate(ward ? `/api/wards/${ward.id}` : "/api/wards", values, { method: ward ? "PATCH" : "POST", success: ward ? "Ward updated" : "Ward created", form });
      if (onSaved) onSaved(r);
      else router.push(`/wards/${r.id}`);
      router.refresh();
    } catch { /* handled by mutate */ }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-6" noValidate>
      <FormSection title="Ward details" description="The code must be unique (e.g. GMW, ICU-2). Bed charges use the daily rate.">
        <TextField form={form} name="name" label="Ward name" required />
        <TextField form={form} name="code" label="Code" required autoComplete="off" />
        <SelectField form={form} name="type" label="Type" required options={WARD_TYPES.map((t) => ({ value: t, label: label(t) }))} />
        <TextField form={form} name="dailyRate" label="Daily rate" required inputMode="decimal" placeholder="3000.00" />
        <SelectField form={form} name="departmentId" label="Department" placeholder="None" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        {ward && <CheckboxField form={form} name="isActive" label="Ward is active (accepts admissions)" className="self-end pb-2" />}
      </FormSection>
      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button href={cancelHref}>Cancel</Button>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>{ward ? "Save changes" : "Create ward"}</Button>
      </div>
    </form>
  );
}
