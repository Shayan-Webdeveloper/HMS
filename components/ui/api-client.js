"use client";
import { toast } from "sonner";

/**
 * fetch wrapper for our JSON API envelope. Throws an Error with .fields for validation errors.
 */
export async function api(url, { method = "GET", body, signal } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
    credentials: "same-origin",
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 401 && typeof window !== "undefined") {
    // Full reload on auth change so no stale client state survives sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login?expired=1");
  }
  if (!res.ok || !json?.ok) {
    const err = new Error(json?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = json?.error?.code;
    err.fields = json?.error?.fields;
    throw err;
  }
  return json;
}

/** Apply server-side field errors to a react-hook-form instance and toast the message. */
export function handleFormError(err, form) {
  if (err.fields && form) {
    for (const [k, msg] of Object.entries(err.fields)) form.setError(k, { type: "server", message: msg });
  }
  toast.error(err.message || "Request failed");
}

export async function mutate(url, body, { method = "POST", success, form } = {}) {
  try {
    const r = await api(url, { method, body });
    if (success) toast.success(success);
    return r.data;
  } catch (e) {
    handleFormError(e, form);
    throw e;
  }
}
