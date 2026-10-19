"use client";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { vitalsSchema } from "@/lib/validation/encounters";
import { api, handleFormError } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Form";

const FIELDS = [
  { name: "systolic", label: "Systolic BP", unit: "mmHg", step: "1" },
  { name: "diastolic", label: "Diastolic BP", unit: "mmHg", step: "1" },
  { name: "pulse", label: "Pulse", unit: "/min", step: "1" },
  { name: "respRate", label: "Respiratory rate", unit: "/min", step: "1" },
  { name: "temperatureC", label: "Temperature", unit: "°C", step: "0.1" },
  { name: "spo2", label: "SpO₂", unit: "%", step: "1" },
  { name: "weightKg", label: "Weight", unit: "kg", step: "0.1" },
  { name: "heightCm", label: "Height", unit: "cm", step: "0.1" },
];

/** Record a set of vital signs. `endpoint` is /api/queue/[id]/vitals or /api/encounters/[id]/vitals. */
export function VitalsDialog({ open, onClose, endpoint, subtitle }) {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(vitalsSchema), defaultValues: Object.fromEntries(FIELDS.map((f) => [f.name, ""])) });
  const rootErr = form.formState.errors._?.message || form.formState.errors.root?.message;
  function close() { form.reset(); onClose(); }
  async function onSubmit(v) {
    try {
      await api(endpoint, { method: "POST", body: v });
      toast.success("Vitals recorded");
      close();
      router.refresh();
    } catch (e) { handleFormError(e, form); }
  }
  return (
    <Modal open={open} onClose={close} title="Record vital signs" description={subtitle}
      footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Save vitals</Button></>}>
      <form className="grid grid-cols-2 gap-3 sm:gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {FIELDS.map((f) => (
          <TextField key={f.name} form={form} name={f.name} label={`${f.label} (${f.unit})`} type="number" inputMode="decimal" step={f.step} />
        ))}
        {rootErr && <p className="col-span-2 field-error" role="alert">{rootErr}</p>}
        <p className="col-span-2 text-[12px] text-subtle">Enter what was measured; leave the rest blank. Values are recorded as entered and are not interpreted.</p>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
