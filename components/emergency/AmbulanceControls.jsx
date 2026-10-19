"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Wrench, CheckCircle2, Send, MapPin, Truck, Flag, XCircle } from "lucide-react";
import { ambulanceSchema, dispatchSchema, AMBULANCE_TYPES, DISPATCH_TRANSITIONS } from "@/lib/validation/emergency";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField, SelectField } from "@/components/ui/Form";

// ── Fleet ───────────────────────────────────────────────

export function AddAmbulanceButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>Add vehicle</Button>
      {open && <AmbulanceDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AmbulanceDialog({ ambulance, onClose }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(ambulanceSchema),
    defaultValues: { vehicleNo: ambulance?.vehicleNo ?? "", type: ambulance?.type ?? "BLS", driverName: ambulance?.driverName ?? "", driverPhone: ambulance?.driverPhone ?? "" },
  });
  async function submit(values) {
    try {
      await mutate(ambulance ? `/api/ambulances/${ambulance.id}` : "/api/ambulances", values, { method: ambulance ? "PATCH" : "POST", success: ambulance ? "Vehicle updated" : "Vehicle added", form });
      onClose(); router.refresh();
    } catch { /* handled */ }
  }
  return (
    <Modal open onClose={onClose} title={ambulance ? `Edit ${ambulance.vehicleNo}` : "Add ambulance"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>{ambulance ? "Save" : "Add vehicle"}</Button></>}>
      <form className="grid sm:grid-cols-2 gap-4" onSubmit={form.handleSubmit(submit)} noValidate>
        <TextField form={form} name="vehicleNo" label="Vehicle number" required />
        <SelectField form={form} name="type" label="Type" required options={AMBULANCE_TYPES.map((t) => ({ value: t, label: t === "ALS" ? "ALS — Advanced life support" : "BLS — Basic life support" }))} />
        <TextField form={form} name="driverName" label="Driver name" />
        <TextField form={form} name="driverPhone" label="Driver phone" type="tel" />
        <button type="submit" className="sr-only">Save</button>
      </form>
    </Modal>
  );
}

export function AmbulanceRowActions({ ambulance, canManage }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!canManage) return null;
  const toMaint = ambulance.status === "AVAILABLE";
  async function setStatus() {
    try {
      await mutate(`/api/ambulances/${ambulance.id}/status`, { status: toMaint ? "MAINTENANCE" : "AVAILABLE" }, { success: toMaint ? "Marked as in maintenance" : "Marked as available" });
      setConfirm(false); router.refresh();
    } catch { setConfirm(false); }
  }
  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(true)} aria-label={`Edit ${ambulance.vehicleNo}`}>Edit</Button>
      {ambulance.status !== "DISPATCHED" && (
        <Button size="sm" icon={toMaint ? Wrench : CheckCircle2} onClick={() => setConfirm(true)}>{toMaint ? "Maintenance" : "Set available"}</Button>
      )}
      {edit && <AmbulanceDialog ambulance={ambulance} onClose={() => setEdit(false)} />}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="primary"
        title={toMaint ? `Take ${ambulance.vehicleNo} off the road?` : `Return ${ambulance.vehicleNo} to service?`}
        message={toMaint ? "The vehicle cannot be dispatched while in maintenance." : "The vehicle will be available for dispatch."}
        confirmLabel={toMaint ? "Set maintenance" : "Set available"} onConfirm={setStatus} />
    </div>
  );
}

// ── Dispatches ──────────────────────────────────────────

export function NewDispatchButton({ ambulances, visits, initialVisitId, autoOpen }) {
  const [open, setOpen] = useState(!!autoOpen);
  return (
    <>
      <Button variant="primary" icon={Send} onClick={() => setOpen(true)} disabled={!ambulances.length} title={!ambulances.length ? "No ambulance is available" : undefined}>New dispatch</Button>
      {open && <DispatchDialog ambulances={ambulances} visits={visits} initialVisitId={initialVisitId} onClose={() => setOpen(false)} />}
    </>
  );
}

function DispatchDialog({ ambulances, visits, initialVisitId, onClose }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(dispatchSchema),
    defaultValues: { ambulanceId: ambulances[0]?.id ?? "", emergencyVisitId: initialVisitId ?? "", pickupAddress: "", destination: "", callerName: "", callerPhone: "" },
  });
  async function submit(values) {
    try { await mutate("/api/ambulances/dispatches", values, { success: "Ambulance dispatched", form }); onClose(); router.refresh(); } catch { /* handled */ }
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Dispatch ambulance" description="Only available vehicles can be dispatched. The vehicle is reserved the moment you submit."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Send} loading={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>Dispatch</Button></>}>
      <form className="grid sm:grid-cols-2 gap-4" onSubmit={form.handleSubmit(submit)} noValidate>
        <SelectField form={form} name="ambulanceId" label="Ambulance" required placeholder={ambulances.length ? undefined : "No available vehicles"}
          options={ambulances.map((a) => ({ value: a.id, label: `${a.vehicleNo} (${a.type})${a.driverName ? ` — ${a.driverName}` : ""}` }))} />
        {visits ? (
          <SelectField form={form} name="emergencyVisitId" label="Link to ER visit" placeholder="None" options={visits.map((v) => ({ value: v.id, label: v.label }))} hint="Optional — for transports related to an ER patient." />
        ) : <div className="hidden sm:block" />}
        <TextField form={form} name="pickupAddress" label="Pickup address" required className="sm:col-span-2" />
        <TextField form={form} name="destination" label="Destination" required className="sm:col-span-2" placeholder="e.g. Hospital ER" />
        <TextField form={form} name="callerName" label="Caller name" />
        <TextField form={form} name="callerPhone" label="Caller phone" type="tel" />
        <button type="submit" className="sr-only">Dispatch</button>
      </form>
    </Modal>
  );
}

const STEP = {
  ON_SCENE: { label: "On scene", icon: MapPin, variant: "primary" },
  TRANSPORTING: { label: "Transporting", icon: Truck, variant: "primary" },
  COMPLETED: { label: "Complete", icon: Flag, variant: "success" },
};

export function DispatchActions({ dispatch, canManage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [cancel, setCancel] = useState(false);
  if (!canManage) return null;
  const next = DISPATCH_TRANSITIONS[dispatch.status] || [];
  if (!next.length) return null;
  async function go(status, reason) {
    setBusy(status);
    try {
      await mutate(`/api/ambulances/dispatches/${dispatch.id}`, { status, reason }, { success: status === "CANCELLED" ? "Dispatch cancelled" : `Dispatch ${STEP[status].label.toLowerCase()}` });
      router.refresh();
      return true;
    } catch { return false; } finally { setBusy(null); }
  }
  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {next.filter((s) => s !== "CANCELLED").map((s) => {
        const st = STEP[s];
        return <Button key={s} size="sm" variant={st.variant} icon={st.icon} loading={busy === s} disabled={!!busy} onClick={() => go(s)}>{st.label}</Button>;
      })}
      {next.includes("CANCELLED") && <Button size="sm" variant="ghost" icon={XCircle} disabled={!!busy} onClick={() => setCancel(true)}>Cancel</Button>}
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} requireReason title="Cancel this dispatch?" message="The ambulance returns to available. This cannot be undone." confirmLabel="Cancel dispatch"
        onConfirm={async (reason) => { if (await go("CANCELLED", reason)) setCancel(false); }} />
    </div>
  );
}
