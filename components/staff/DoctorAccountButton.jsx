"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mutate } from "@/components/ui/api-client";
import { TempPasswordModal } from "./TempPasswordModal";

export function DoctorAccountButton({ doctorId, email }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [created, setCreated] = useState(null);
  return (
    <>
      <Button icon={KeyRound} onClick={() => setConfirm(true)}>Create login</Button>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="primary" title="Create a login account?"
        message={email ? `A DOCTOR account will be created for ${email} with a one-time temporary password. The doctor must change it at first sign-in.` : "Add a work email to the doctor's profile first."}
        confirmLabel="Create account"
        onConfirm={async () => {
          try {
            const r = await mutate(`/api/doctors/${doctorId}/account`, {}, { success: "Login account created" });
            setConfirm(false);
            setCreated(r);
          } catch { /* toast shown */ }
        }} />
      {created && <TempPasswordModal open email={created.email} password={created.temporaryPassword} onClose={() => { setCreated(null); router.refresh(); }} />}
    </>
  );
}
