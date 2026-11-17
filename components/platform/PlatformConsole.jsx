"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Building2, UserPlus, Power, KeyRound } from "lucide-react";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, SelectField } from "@/components/ui/Form";
import { TempPasswordModal } from "@/components/staff/TempPasswordModal";

// Platform console: manages hospital tenants only. It never shows or requests hospital records.

export function CreateHospitalForm() {
  const router = useRouter();
  const form = useForm({ defaultValues: { name: "", code: "", timezone: "Asia/Karachi", currency: "PKR", locale: "en-PK", address: "", phone: "", email: "" } });
  async function onSubmit(v) {
    try {
      await mutate("/api/platform/hospitals", v, { success: `Hospital "${v.name}" created`, form });
      form.reset();
      router.refresh();
    } catch {}
  }
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <TextField form={form} name="name" label="Hospital name" required />
      <TextField form={form} name="code" label="Code" required hint="2–12 letters/digits, unique (e.g. CITY)" />
      <TextField form={form} name="timezone" label="Time zone" required />
      <TextField form={form} name="currency" label="Currency" required hint="ISO code, e.g. PKR" />
      <TextField form={form} name="phone" label="Phone" />
      <TextField form={form} name="email" label="Email" type="email" />
      <TextField form={form} name="address" label="Address" className="sm:col-span-2" />
      <div className="sm:col-span-2"><Button type="submit" variant="primary" icon={Building2} loading={form.formState.isSubmitting}>Create hospital</Button></div>
    </form>
  );
}

export function HospitalActions({ hospital }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [created, setCreated] = useState(null);
  const form = useForm({ defaultValues: { email: "", name: "", role: "SUPER_ADMIN" } });

  async function toggle(reason) {
    try {
      await mutate(`/api/platform/hospitals/${hospital.id}`, { active: !hospital.isActive, reason }, { method: "PATCH", success: hospital.isActive ? "Hospital deactivated" : "Hospital reactivated" });
      setConfirm(false);
      router.refresh();
    } catch {}
  }
  async function addAdmin(v) {
    try {
      const r = await mutate(`/api/platform/hospitals/${hospital.id}/admins`, { email: v.email, role: v.role, ...(v.name ? { name: v.name } : {}) }, { success: "Administrator appointed", form });
      setAdminOpen(false);
      form.reset();
      if (r.temporaryPassword) setCreated({ email: v.email, password: r.temporaryPassword });
      router.refresh();
    } catch {}
  }
  return (
    <div className="flex flex-wrap gap-2 justify-end">
      <Button size="sm" icon={UserPlus} onClick={() => setAdminOpen(true)} disabled={!hospital.isActive}>Add administrator</Button>
      <Button size="sm" variant={hospital.isActive ? "danger" : "secondary"} icon={Power} onClick={() => setConfirm(true)}>{hospital.isActive ? "Deactivate" : "Reactivate"}</Button>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={toggle} requireReason reasonLabel="Reason"
        tone={hospital.isActive ? "danger" : "primary"}
        title={hospital.isActive ? `Deactivate ${hospital.name}?` : `Reactivate ${hospital.name}?`}
        message={hospital.isActive ? "Everyone working in this hospital is signed out immediately and nobody can sign in to it until it is reactivated. No data is deleted." : "Members with active memberships can sign in to this hospital again."}
        confirmLabel={hospital.isActive ? "Deactivate" : "Reactivate"} />
      <Modal open={adminOpen} onClose={() => setAdminOpen(false)} title={`Add administrator — ${hospital.name}`}
        description="A new email creates an account with a one-time temporary password. An existing account (e.g. someone who works at another hospital) is given access to this hospital.">
        <form onSubmit={form.handleSubmit(addAdmin)} noValidate className="space-y-4">
          <TextField form={form} name="email" label="Email" type="email" required />
          <TextField form={form} name="name" label="Full name" hint="Required for a new account" />
          <SelectField form={form} name="role" label="Role in this hospital" required options={[
            { value: "SUPER_ADMIN", label: "Super Administrator (full hospital access)" },
            { value: "HOSPITAL_ADMIN", label: "Hospital Administrator" },
          ]} />
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Appoint</Button>
        </form>
      </Modal>
      <TempPasswordModal open={!!created} email={created?.email} password={created?.password} onClose={() => setCreated(null)} />
    </div>
  );
}

export function ResetAccountPassword() {
  const form = useForm({ defaultValues: { email: "" } });
  const [created, setCreated] = useState(null);
  async function onSubmit(v) {
    try {
      const r = await mutate("/api/platform/users/reset-password", v, { success: "Temporary password issued", form });
      setCreated({ email: v.email, password: r.temporaryPassword });
      form.reset();
    } catch {}
  }
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col sm:flex-row gap-3 sm:items-end">
      <TextField form={form} name="email" label="Account email" type="email" required className="sm:w-80" />
      <Button type="submit" icon={KeyRound} loading={form.formState.isSubmitting}>Issue temporary password</Button>
      <TempPasswordModal open={!!created} email={created?.email} password={created?.password} onClose={() => setCreated(null)} />
    </form>
  );
}

export function HospitalStatus({ active }) {
  return active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Deactivated</Badge>;
}

