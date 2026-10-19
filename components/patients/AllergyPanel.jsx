"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { allergySchema } from "@/lib/validation/patients";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField, SelectField } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";

export function AllergyPanel({ patientId, allergies, canEdit }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm({ resolver: zodResolver(allergySchema), defaultValues: { substance: "", reaction: "", severity: "UNKNOWN" } });
  async function onSubmit(v) {
    try { await mutate(`/api/patients/${patientId}/allergies`, v, { success: "Allergy recorded", form }); setOpen(false); form.reset(); router.refresh(); } catch {}
  }
  async function remove(id) {
    try { await mutate(`/api/patients/${patientId}/allergies`, { allergyId: id }, { method: "DELETE", success: "Allergy marked inactive" }); router.refresh(); } catch {}
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center">
        {allergies.length === 0 && <span className="text-[13px] text-muted">No known allergies recorded</span>}
        {allergies.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-danger-soft text-danger text-[12.5px] font-semibold pl-2.5 pr-1 h-7">
            {a.substance}{a.reaction ? ` — ${a.reaction}` : ""} <Badge tone="danger" plain className="!h-5 !px-1.5 bg-white/60">{a.severity.toLowerCase()}</Badge>
            {canEdit && <button type="button" onClick={() => remove(a.id)} className="p-1 rounded-full hover:bg-white/60" aria-label={`Mark ${a.substance} allergy inactive`}><X size={12} /></button>}
          </span>
        ))}
        {canEdit && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setOpen(true)}>Add allergy</Button>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Record allergy"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(onSubmit)}>Save</Button></>}>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
          <TextField form={form} name="substance" label="Substance" required />
          <TextField form={form} name="reaction" label="Reaction" />
          <SelectField form={form} name="severity" label="Severity" options={["MILD", "MODERATE", "SEVERE", "UNKNOWN"].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
        </form>
      </Modal>
    </div>
  );
}
