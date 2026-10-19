"use client";
import { useState } from "react";
import { Copy, Check, KeyRound, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

/**
 * Shows a freshly generated temporary password exactly once. It lives only in component state:
 * never in the URL, localStorage or logs. Closing the dialog discards it.
 */
export function TempPasswordModal({ open, email, password, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked — user can select the text */ }
  }
  return (
    <Modal open={open} onClose={onClose} title="Login account created"
      description="Share these credentials with the user through a secure channel."
      footer={<Button variant="primary" onClick={onClose}>I've recorded it — close</Button>}>
      <div className="space-y-4">
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning font-medium flex items-start gap-2" role="note">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
          This temporary password is shown only once. The user must change it at first sign-in.
        </div>
        <dl className="space-y-3">
          <div>
            <dt className="field-label">Sign-in email</dt>
            <dd className="font-medium text-[14px] break-all">{email}</dd>
          </div>
          <div>
            <dt className="field-label flex items-center gap-1.5"><KeyRound size={13} aria-hidden /> Temporary password</dt>
            <dd className="flex items-center gap-2">
              <code className="flex-1 min-w-0 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[15px] tracking-wider select-all break-all" aria-label="Temporary password">{password}</code>
              <Button icon={copied ? Check : Copy} onClick={copy} aria-label="Copy password">{copied ? "Copied" : "Copy"}</Button>
            </dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
