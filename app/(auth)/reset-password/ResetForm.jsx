"use client";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";

const schema = z.object({
  password: z.string().min(10, "At least 10 characters").regex(/[A-Za-z]/, "Include a letter").regex(/[0-9]/, "Include a number"),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export default function ResetForm({ token }) {
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(token ? "" : "This reset link is missing its token. Request a new link.");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });
  async function onSubmit(v) {
    setError("");
    try { const r = await api("/api/auth/reset-password", { method: "POST", body: { token, password: v.password } }); setMsg(r.data.message); }
    catch (e) { setError(e.message); }
  }
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      {msg ? (
        <div className="mt-6 space-y-4"><p className="rounded-lg bg-success-soft text-success p-3 text-[13.5px]" role="status">{msg}</p><Link href="/login" className="btn btn-primary w-full">Go to sign in</Link></div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          {error && <div role="alert" className="rounded-lg bg-danger-soft text-danger text-[13px] px-3 py-2">{error} <Link href="/forgot-password" className="underline font-semibold">Request new link</Link></div>}
          <FormField label="New password" required error={errors.password?.message} hint="At least 10 characters, with a letter and a number.">{(a) => <Input type="password" autoComplete="new-password" {...a} {...register("password")} />}</FormField>
          <FormField label="Confirm password" required error={errors.confirm?.message}>{(a) => <Input type="password" autoComplete="new-password" {...a} {...register("confirm")} />}</FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting} disabled={!token}>Update password</Button>
        </form>
      )}
    </div>
  );
}
