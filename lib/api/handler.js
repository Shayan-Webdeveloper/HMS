import "server-only";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { ApiError, unauthorized, forbidden } from "@/lib/errors";
import { getSession, can, clientIp } from "@/lib/auth/session";
import { runWithTenant, TenantContextError } from "@/lib/db/prisma";
import { serialize } from "@/lib/utils/serialize";

// Consistent API envelope:
//   success → { ok: true, data, meta? }
//   failure → { ok: false, error: { code, message, fields? } }

export function ok(data, meta, init) {
  return Response.json({ ok: true, data: serialize(data), ...(meta ? { meta } : {}) }, init);
}

export function errorResponse(err) {
  if (err instanceof ApiError) {
    return Response.json({ ok: false, error: { code: err.code, message: err.message, ...(err.details ? { fields: err.details } : {}) } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    return Response.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Please correct the highlighted fields.", fields } }, { status: 422 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return Response.json({ ok: false, error: { code: "CONFLICT", message: "A record with these details already exists." } }, { status: 409 });
    if (err.code === "P2025") return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Record not found." } }, { status: 404 });
    if (err.code === "P2034") return Response.json({ ok: false, error: { code: "CONFLICT", message: "The record was changed by someone else. Please retry." } }, { status: 409 });
  }
  if (err instanceof TenantContextError) {
    console.error("[tenant] operation without a valid hospital context:", err.message);
    return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "You do not have access to this hospital's data." } }, { status: 403 });
  }
  const msg = String(err?.message || "");
  // Database-level tenant guards (RLS / same-hospital triggers). Reaching them means the application
  // layer let something through — treat it as "not found" so nothing about other hospitals leaks.
  if (msg.includes("HMS_TENANT_VIOLATION") || msg.includes("row-level security")) {
    console.error("[tenant] database isolation guard triggered:", msg.slice(0, 200));
    return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Record not found." } }, { status: 404 });
  }
  // Check-constraint violations from the database (stock, bed occupancy, money sanity).
  if (msg.includes("violates check constraint")) {
    return Response.json({ ok: false, error: { code: "INVALID_STATE", message: "This change would break a data-integrity rule (e.g. negative stock or double allocation)." } }, { status: 422 });
  }
  const ref = Math.random().toString(36).slice(2, 10);
  // Log without request bodies — they may contain patient data.
  console.error(`[api-error ${ref}]`, err?.name, err?.code ?? "", msg.slice(0, 500));
  return Response.json({ ok: false, error: { code: "INTERNAL", message: `Something went wrong. Reference: ${ref}` } }, { status: 500 });
}

async function assertSameOrigin(req) {
  // CSRF defence-in-depth on top of SameSite=Lax cookies: state-changing
  // requests must come from our own origin.
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return; // non-browser clients (no ambient cookies by default)
  const host = h.get("x-forwarded-host") || h.get("host");
  let originHost;
  try { originHost = new URL(origin).host; } catch { throw forbidden("Invalid request origin"); }
  if (originHost !== host) throw forbidden("Cross-site request blocked");
}

/**
 * Wrap a route handler with auth, permission checks, CSRF protection and error mapping.
 * Every non-public route runs inside the session's hospital context (lib/db/tenant-client.js): all
 * database access is limited to that hospital. The hospital always comes from the server-side
 * session, never from the request.
 * @param {{ permission?: string|string[], public?: boolean, portal?: boolean, platform?: boolean }} opts
 *   platform: Platform Administrator routes (hospital management). They run WITHOUT a hospital context
 *   and may only use systemPrisma with explicit filters; they never get hospital permissions.
 */
export function route(opts, fn) {
  return async (req, ctx) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") await assertSameOrigin(req);
      const session = await getSession();
      if (!opts.public && !session) throw unauthorized();
      if (opts.platform) {
        if (!session.isPlatformAdmin) throw forbidden();
      } else if (opts.portal) {
        if (!session.hospitalId || !can(session, "portal:access") || !session.patientId) throw forbidden();
      } else if (!opts.public) {
        if (session.isPatient) throw forbidden();
        if (!session.hospitalId) throw forbidden("Select a hospital to continue.");
      }
      if (!opts.public && session.user.mustChangePassword) {
        throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Set a new password before continuing.");
      }
      if (opts.permission && !can(session, opts.permission)) throw forbidden();
      const params = ctx?.params ? await ctx.params : {};
      const h = await headers();
      const invoke = () => fn({
        req,
        session,
        params,
        ip: clientIp(h),
        body: async (schema) => {
          let json;
          try { json = await req.json(); } catch { throw new ApiError(400, "BAD_REQUEST", "Request body must be valid JSON."); }
          return schema ? schema.parse(json) : json;
        },
        query: (schema) => {
          const obj = Object.fromEntries(new URL(req.url).searchParams.entries());
          return schema ? schema.parse(obj) : obj;
        },
      });
      // Platform routes never receive a hospital context; everything else runs inside the session's hospital.
      const result = session?.hospitalId && !opts.platform
        ? await runWithTenant({ hospitalId: session.hospitalId, userId: session.user.id }, invoke)
        : await invoke();
      if (result instanceof Response) return result;
      return ok(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
