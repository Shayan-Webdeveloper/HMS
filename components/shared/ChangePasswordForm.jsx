"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { mutate } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Form";

const schema = z.object({
  currentPassword: z.string().min(1, "Required"),
  newPassword: z.string().min(10, "At least 10 characters").regex(/[A-Za-z]/, "Include a letter").regex(/[0-9]/, "Include a number"),
  confirm: z.string(),
}).refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export function ChangePasswordForm() {
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  async function onSubmit(v) {
    try {
      await mutate("/api/auth/change-password", { currentPassword: v.currentPassword, newPassword: v.newPassword }, { success: "Password changed", form });
      form.reset();
    } catch {}
  }
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md" noValidate>
      <TextField form={form} name="currentPassword" type="password" label="Current password" required autoComplete="current-password" />
      <TextField form={form} name="newPassword" type="password" label="New password" required autoComplete="new-password" hint="At least 10 characters, with a letter and a number." />
      <TextField form={form} name="confirm" type="password" label="Confirm new password" required autoComplete="new-password" />
      <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Change password</Button>
    </form>
  );
}
