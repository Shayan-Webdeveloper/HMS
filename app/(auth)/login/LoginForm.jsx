"use client";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { loginSchema } from "@/lib/validation/auth";
import { api } from "@/components/ui/api-client";
import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";

export default function LoginForm({ expired, showDemo }) {
  const [show, setShow] = useState(false);
  const [error, setError] = useState(expired ? "Your session expired. Please sign in again." : "");
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;

  async function onSubmit(values) {
    setError("");
    try {
      const r = await api("/api/auth/login", { method: "POST", body: values });
      window.location.assign(r.data.mustChangePassword ? "/account?first=1" : r.data.redirect);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="text-muted mt-1 text-[13.5px]">Use the account issued by your hospital administrator.</p>
      {error && <div role="alert" className="mt-5 rounded-lg border border-danger/30 bg-danger-soft text-danger text-[13px] px-3 py-2.5">{error}</div>}
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <FormField label="Email" required error={errors.email?.message}>
          {(a) => <Input type="email" autoComplete="username" autoFocus {...a} {...register("email")} />}
        </FormField>
        <FormField label="Password" required error={errors.password?.message}>
          {(a) => (
            <div className="relative">
              <Input type={show ? "text" : "password"} autoComplete="current-password" className="pr-10" {...a} {...register("password")} />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-subtle hover:text-ink" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          )}
        </FormField>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[13px] font-semibold text-primary hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={isSubmitting} icon={LogIn}>Sign in</Button>
      </form>
      {showDemo && (
        <div className="mt-8 rounded-lg border border-border bg-surface-2 p-3 text-[12.5px] text-muted">
          <p className="font-semibold text-ink">Development demo accounts</p>
          <p className="mt-1">After running <code className="kbd">npm run seed</code>, sign in with any seeded account (e.g. <code>admin@demo.hms</code>, <code>reception@demo.hms</code>, <code>dr.khan@demo.hms</code>) using the password set in <code>SEED_DEMO_PASSWORD</code>. Never use these in production.</p>
        </div>
      )}
    </div>
  );
}
