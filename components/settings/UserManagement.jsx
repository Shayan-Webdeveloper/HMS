"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { UserPlus, ShieldCheck, UserX, UserCheck, KeyRound, Link2, Unlink, Copy, AlertTriangle, MoreHorizontal } from "lucide-react";
import { createUserSchema } from "@/lib/validation/users";
import { mutate, api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField } from "@/components/ui/Form";

/** Shows a one-time temporary password. It is held only in component state and never persisted. */
export function TempPasswordModal({ open, onClose, email, password, sessionsRevoked }) {
  async function copy() {
    try { await navigator.clipboard.writeText(password); toast.success("Copied to clipboard"); } catch { toast.error("Copy failed — select and copy manually"); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Temporary password" description={`For ${email}. This is shown only once.`}
      footer={<Button variant="primary" onClick={onClose}>I have shared it securely</Button>}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all rounded-lg border border-border-strong bg-surface-2 px-3 py-2.5 font-mono text-[16px] tracking-wider break-all" aria-label="Temporary password">{password}</code>
          <Button icon={Copy} onClick={copy}>Copy</Button>
        </div>
        <p className="text-[13px] text-muted flex gap-2"><AlertTriangle size={15} className="text-warning shrink-0 mt-0.5" aria-hidden />Give it to the user in person or over a trusted channel — never by unencrypted email. They must set a new password at first sign-in.{sessionsRevoked != null && ` ${sessionsRevoked} active session${sessionsRevoked === 1 ? " was" : "s were"} signed out.`}</p>
      </div>
    </Modal>
  );
}

function RoleChecklist({ roles, value, onChange, disabledKeys = [], idPrefix }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {roles.map((r) => {
        const disabled = disabledKeys.includes(r.key);
        return (
          <label key={r.key} htmlFor={`${idPrefix}-${r.key}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${value.includes(r.key) ? "border-primary bg-primary-soft/50" : "border-border"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
            <input id={`${idPrefix}-${r.key}`} type="checkbox" className="checkbox mt-0.5" checked={value.includes(r.key)} disabled={disabled} onChange={() => toggle(r.key)} />
            <span className="min-w-0"><span className="block text-[13px] font-semibold">{r.name}</span>{r.description && <span className="block text-[11.5px] text-muted">{r.description}</span>}</span>
          </label>
        );
      })}
    </div>
  );
}

export function CreateUserButton({ roles, actorIsSuper }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(null);
  const form = useForm({ resolver: zodResolver(createUserSchema), defaultValues: { name: "", email: "", roles: [], patientMrn: "" } });
  const selected = useWatch({ control: form.control, name: "roles" }) ?? [];
  const isPatient = selected.length === 1 && selected[0] === "PATIENT";
  const disabledKeys = [
    ...(actorIsSuper ? [] : ["SUPER_ADMIN"]),
    ...(selected.includes("PATIENT") ? roles.map((r) => r.key).filter((k) => k !== "PATIENT") : selected.length ? ["PATIENT"] : []),
  ];
  async function submit(values) {
    try {
      const r = await mutate("/api/users", { ...values, patientMrn: isPatient ? values.patientMrn : undefined }, { form });
      setOpen(false);
      form.reset();
      setCreated({ email: r.user.email, password: r.temporaryPassword });
      router.refresh();
    } catch { /* handled by mutate */ }
  }
  return (
    <>
      <Button variant="primary" icon={UserPlus} onClick={() => setOpen(true)}>New user</Button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title="Create user" description="A random temporary password is generated and shown once. The user must change it at first sign-in."
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Create user</Button></>}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField form={form} name="name" label="Full name" required autoComplete="off" />
            <TextField form={form} name="email" label="Email (sign-in)" type="email" required autoComplete="off" />
          </div>
          <div>
            <p className="field-label">Roles<span className="req">*</span></p>
            <RoleChecklist idPrefix="new" roles={roles} value={selected} disabledKeys={disabledKeys} onChange={(v) => form.setValue("roles", v, { shouldValidate: form.formState.isSubmitted, shouldDirty: true })} />
            {form.formState.errors.roles && <p className="field-error" role="alert">{form.formState.errors.roles.message}</p>}
            <p className="field-hint">Patient portal accounts cannot hold staff roles. {actorIsSuper ? "" : "Only a Super Administrator can grant Super Administrator."}</p>
          </div>
          {isPatient && <TextField form={form} name="patientMrn" label="Link to patient (MRN)" placeholder="MRN-000123" hint="Optional now — you can link the record later. Linking grants portal access to that patient's records." />}
          <button type="submit" hidden />
        </form>
      </Modal>
      {created && <TempPasswordModal open onClose={() => setCreated(null)} email={created.email} password={created.password} />}
    </>
  );
}

export function UserRowActions({ user, roles, actorId, actorIsSuper }) {
  const router = useRouter();
  const [dialog, setDialog] = useState(null);
  const [rolesDraft, setRolesDraft] = useState(user.roles);
  const [busy, setBusy] = useState(false);
  const [mrn, setMrn] = useState("");
  const [temp, setTemp] = useState(null);
  const self = user.id === actorId;
  const targetSuper = user.roles.includes("SUPER_ADMIN");
  const locked = targetSuper && !actorIsSuper;
  const isPatientAccount = user.roles.length === 1 && user.roles[0] === "PATIENT";
  const close = () => { setDialog(null); setRolesDraft(user.roles); setMrn(""); };

  async function run(fn) {
    setBusy(true);
    try { await fn(); close(); router.refresh(); } catch { /* toast shown by mutate */ } finally { setBusy(false); }
  }

  if (locked) return <span className="text-xs text-subtle" title="Only a Super Administrator can change Super Administrator accounts">Protected</span>;
  const disabledKeys = [
    ...(actorIsSuper ? [] : ["SUPER_ADMIN"]),
    ...(self && targetSuper ? ["SUPER_ADMIN"] : []),
    ...(rolesDraft.includes("PATIENT") ? roles.map((r) => r.key).filter((k) => k !== "PATIENT") : rolesDraft.length ? ["PATIENT"] : []),
  ];

  return (
    <div className="flex flex-wrap gap-1 justify-end">
      {(!self || actorIsSuper) && <Button size="sm" variant="ghost" icon={ShieldCheck} onClick={() => { setRolesDraft(user.roles); setDialog("roles"); }}>Roles</Button>}
      {!self && user.isActive && <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setDialog("reset")}>Reset password</Button>}
      {isPatientAccount && <Button size="sm" variant="ghost" icon={user.patientLink ? Unlink : Link2} onClick={() => setDialog(user.patientLink ? "unlink" : "link")}>{user.patientLink ? "Unlink" : "Link patient"}</Button>}
      {!self && (user.isActive
        ? <Button size="sm" variant="ghost" className="text-danger" icon={UserX} onClick={() => setDialog("deactivate")}>Deactivate</Button>
        : <Button size="sm" variant="ghost" className="text-success" icon={UserCheck} onClick={() => setDialog("reactivate")}>Reactivate</Button>)}
      {self && !actorIsSuper && <span className="text-xs text-subtle inline-flex items-center gap-1"><MoreHorizontal size={13} aria-hidden />You</span>}

      <Modal open={dialog === "roles"} onClose={close} size="lg" title={`Roles — ${user.name}`} description="Role changes apply on the user's next request. All changes are audited."
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} disabled={!rolesDraft.length} onClick={() => run(() => mutate(`/api/users/${user.id}`, { roles: rolesDraft }, { method: "PATCH", success: "Roles updated" }))}>Save roles</Button></>}>
        <RoleChecklist idPrefix={`r-${user.id}`} roles={roles} value={rolesDraft} onChange={setRolesDraft} disabledKeys={disabledKeys} />
        {self && targetSuper && <p className="field-hint mt-2">You cannot remove your own Super Administrator role.</p>}
        {user.patientLink && <p className="field-hint mt-2">This account is linked to patient {user.patientLink.patient.mrn}; unlink it before assigning staff roles.</p>}
      </Modal>

      <ConfirmDialog open={dialog === "deactivate"} onClose={close} requireReason title={`Deactivate ${user.name}?`} confirmLabel="Deactivate"
        message="The user is signed out everywhere immediately and can no longer sign in. Their history is kept and the account can be reactivated."
        onConfirm={(reason) => run(() => mutate(`/api/users/${user.id}/status`, { active: false, reason }, { success: "User deactivated" }))} />
      <ConfirmDialog open={dialog === "reactivate"} onClose={close} tone="primary" title={`Reactivate ${user.name}?`} confirmLabel="Reactivate"
        message="The user will be able to sign in again with their existing password. Consider resetting the password as well."
        onConfirm={() => run(() => mutate(`/api/users/${user.id}/status`, { active: true }, { success: "User reactivated" }))} />
      <ConfirmDialog open={dialog === "reset"} onClose={close} title={`Reset password for ${user.name}?`} confirmLabel="Reset password"
        message="A new temporary password is generated and shown once. The current password stops working, every session is signed out, and the user must choose a new password at next sign-in."
        onConfirm={() => run(async () => { const r = await mutate(`/api/users/${user.id}/reset-password`, {}, { success: "Password reset" }); setTemp({ password: r.temporaryPassword, sessionsRevoked: r.sessionsRevoked }); })} />
      <ConfirmDialog open={dialog === "unlink"} onClose={close} title="Unlink patient record?" confirmLabel="Unlink"
        message={`The account loses portal access to ${user.patientLink?.patient.mrn ?? "the patient"}'s records and is signed out. Clinical records are not changed.`}
        onConfirm={() => run(() => api(`/api/users/${user.id}/patient-link`, { method: "DELETE" }).then(() => toast.success("Patient unlinked")).catch((e) => { toast.error(e.message); throw e; }))} />
      <Modal open={dialog === "link"} onClose={close} title="Link to patient record" description="Grants this portal account access to one patient's own records. Verify the person's identity before linking."
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} disabled={mrn.trim().length < 3} onClick={() => run(() => mutate(`/api/users/${user.id}/patient-link`, { mrn: mrn.trim() }, { success: "Patient linked" }))}>Link patient</Button></>}>
        <label htmlFor={`mrn-${user.id}`} className="field-label">Patient MRN<span className="req">*</span></label>
        <input id={`mrn-${user.id}`} className="input font-mono uppercase" placeholder="MRN-000123" value={mrn} onChange={(e) => setMrn(e.target.value)} />
        <p className="field-hint">The patient must be active and not linked to another account.</p>
      </Modal>
      {temp && <TempPasswordModal open onClose={() => setTemp(null)} email={user.email} password={temp.password} sessionsRevoked={temp.sessionsRevoked} />}
    </div>
  );
}
