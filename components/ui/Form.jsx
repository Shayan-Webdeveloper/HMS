"use client";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils/cn";

/** Label + control + hint + accessible error. Pass `children` as a render fn receiving {id, describedBy, invalid}. */
export function FormField({ label, required, error, hint, className, children }) {
  const id = useId();
  const errId = `${id}-err`, hintId = `${id}-hint`;
  const describedBy = [error && errId, hint && hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="field-label">{label}{required && <span className="req" aria-hidden>*</span>}</label>}
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required || undefined })}
      {hint && !error && <p id={hintId} className="field-hint">{hint}</p>}
      {error && <p id={errId} className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn("input", className)} {...p} />;
});
export const Select = forwardRef(function Select({ className, children, ...p }, ref) {
  return <select ref={ref} className={cn("select", className)} {...p}>{children}</select>;
});
export const Textarea = forwardRef(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn("textarea", className)} {...p} />;
});

/** Convenience wrappers for react-hook-form: <TextField form={form} name="firstName" label="First name" /> */
export function TextField({ form, name, label, required, hint, type = "text", className, ...rest }) {
  const err = getErr(form, name);
  return (
    <FormField label={label} required={required} error={err} hint={hint} className={className}>
      {(a) => <Input type={type} {...a} {...form.register(name)} {...rest} />}
    </FormField>
  );
}
export function SelectField({ form, name, label, required, hint, options, placeholder, className, ...rest }) {
  const err = getErr(form, name);
  return (
    <FormField label={label} required={required} error={err} hint={hint} className={className}>
      {(a) => (
        <Select {...a} {...form.register(name)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )}
    </FormField>
  );
}
export function TextareaField({ form, name, label, required, hint, className, ...rest }) {
  const err = getErr(form, name);
  return (
    <FormField label={label} required={required} error={err} hint={hint} className={className}>
      {(a) => <Textarea {...a} {...form.register(name)} {...rest} />}
    </FormField>
  );
}
export function CheckboxField({ form, name, label, className }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-[13.5px] cursor-pointer", className)}>
      <input type="checkbox" className="checkbox" {...form.register(name)} />
      {label}
    </label>
  );
}

function getErr(form, name) {
  const parts = name.split(".");
  let e = form.formState.errors;
  for (const p of parts) e = e?.[p];
  return e?.message;
}

export function FormSection({ title, description, children }) {
  return (
    <fieldset className="border-0 p-0 m-0">
      {title && <legend className="text-[13px] font-semibold text-ink mb-0.5">{title}</legend>}
      {description && <p className="text-xs text-muted mb-3">{description}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">{children}</div>
    </fieldset>
  );
}
