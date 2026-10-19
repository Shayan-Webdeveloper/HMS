import "server-only";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { ApiError, unauthorized, forbidden } from "@/lib/errors";
import { getSession, can, clientIp } from "@/lib/auth/session";
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
  // Check-constraint violations from the database (stock, bed occupancy, money sanity).
  const msg = String(err?.message || "");
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
 * @param {{ permission?: string|string[], public?: boolean, portal?: boolean }} opts
 */
export function route(opts, fn) {
  return async (req, ctx) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") await assertSameOrigin(req);
      const session = await getSession();
      if (!opts.public && !session) throw unauthorized();
      if (opts.portal) {
        if (!can(session, "portal:access") || !session.patientId) throw forbidden();
      } else if (!opts.public && session.isPatient) {
        throw forbidden();
      }
      if (!opts.public && session.user.mustChangePassword) {
        throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Set a new password before continuing.");
      }
      if (opts.permission && !can(session, opts.permission)) throw forbidden();
      const params = ctx?.params ? await ctx.params : {};
      const h = await headers();
      const result = await fn({
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
      if (result instanceof Response) return result;
      return ok(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
