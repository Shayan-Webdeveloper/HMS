"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, CheckboxField } from "@/components/ui/Form";
import { mutate } from "@/components/ui/api-client";
import { providerSchema } from "@/lib/validation/insurance";

export function AddProviderButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>Add provider</Button>
      {open && <ProviderDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function ProviderRowActions({ provider }) {
  const router = useRouter();
  const [mode, setMode] = useState(null);
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setMode("edit")} aria-label={`Edit ${provider.name}`}>Edit</Button>
      <Button size="sm" variant="ghost" icon={provider.isActive ? PowerOff : Power} onClick={() => setMode("toggle")}>{provider.isActive ? "Deactivate" : "Activate"}</Button>
      {mode === "edit" && <ProviderDialog provider={provider} onClose={() => setMode(null)} />}
      <ConfirmDialog open={mode === "toggle"} onClose={() => setMode(null)} tone={provider.isActive ? "danger" : "primary"}
        title={provider.isActive ? `Deactivate ${provider.name}?` : `Activate ${provider.name}?`}
        message={provider.isActive ? "New policies and claims cannot use an inactive provider. Existing policies and claims are kept." : "The provider can be used for new policies and claims again."}
        confirmLabel={provider.isActive ? "Deactivate" : "Activate"}
        onConfirm={async () => { try { await mutate(`/api/insurance/providers/${provider.id}`, { isActive: !provider.isActive }, { method: "PATCH", success: provider.isActive ? "Provider deactivated" : "Provider activated" }); setMode(null); router.refresh(); } catch {} }} />
    </div>
  );
}

function ProviderDialog({ provider, onClose }) {
  const router = useRouter();
  const form = useForm({ resolver: zodResolver(providerSchema), defaultValues: { name: provider?.name ?? "", phone: provider?.phone ?? "", email: provider?.email ?? "", isActive: provider?.isActive ?? true } });
  async function submit(values) {
    try {
      await mutate(provider ? `/api/insurance/providers/${provider.id}` : "/api/insurance/providers", values, { method: provider ? "PATCH" : "POST", form, success: provider ? "Provider updated" : "Provider added" });
      onClose(); router.refresh();
    } catch {}
  }
  return (
    <Modal open onClose={onClose} title={provider ? "Edit provider" : "Add insurance provider"}
      footer={<><Button onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>{provider ? "Save changes" : "Add provider"}</Button></>}>
      <form onSubmit={form.handleSubmit(submit)} className="grid grid-cols-1 sm:grid-cols-2 gap-4" noValidate>
        <TextField form={form} name="name" label="Name" required className="sm:col-span-2" />
        <TextField form={form} name="phone" label="Phone" type="tel" />
        <TextField form={form} name="email" label="Email" type="email" />
        <CheckboxField form={form} name="isActive" label="Active" />
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
  );
}
