"use client";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck, ArrowLeft } from "lucide-react";
import { forgotSchema } from "@/lib/validation/auth";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(forgotSchema) });
  async function onSubmit(v) {
    setError("");
    try { const r = await api("/api/auth/forgot-password", { method: "POST", body: v }); setDone(r.data.message); }
    catch (e) { setError(e.message); }
  }
  return (
    <div>
      <Link href="/login" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} /> Back to sign in</Link>
      <h1 className="text-2xl font-bold tracking-tight mt-4">Reset your password</h1>
      {done ? (
        <div className="mt-6 rounded-lg border border-success/30 bg-success-soft p-4 text-[13.5px] text-success flex gap-3" role="status">
          <MailCheck size={20} className="shrink-0" /> <span>{done}</span>
        </div>
      ) : (
        <>
          <p className="text-muted mt-1 text-[13.5px]">Enter your account email and we'll send a reset link valid for 60 minutes.</p>
          {error && <div role="alert" className="mt-4 rounded-lg bg-danger-soft text-danger text-[13px] px-3 py-2">{error}</div>}
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            <FormField label="Email" required error={errors.email?.message}>{(a) => <Input type="email" autoComplete="email" {...a} {...register("email")} />}</FormField>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting}>Send reset link</Button>
          </form>
        </>
      )}
    </div>
  );
}
