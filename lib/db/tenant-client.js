// Hospital-scoped Prisma client (multi-hospital isolation, application + database layer).
//
// Every operation made through this client:
//   1. resolves the current hospital from the request context (never from client input) and fails
//      closed with TenantContextError when there is none;
//   2. adds `hospitalId = <current hospital>` to the WHERE clause of every read/update/delete on a
//      hospital-owned model (application-level isolation, also lets queries use tenant indexes);
//   3. runs inside a transaction that first executes
//          set_config('role', 'hms_app', true), set_config('app.hospital_id', <id>, true)
//      so PostgreSQL row-level security enforces the same boundary for every query — including raw
//      SQL, nested includes and nested writes (database-level isolation). Both settings are
//      transaction-local and disappear at COMMIT/ROLLBACK, so pooled connections never leak context.
//
// Interactive transactions (`prisma.$transaction(async (tx) => …)`) open ONE database transaction with
// the context set once; every operation inside the callback — through `tx` or through the global client
// — is routed to that transaction. Nested `$transaction` calls join the outer one.
//
// This module is not "server-only" so the seed and the integration tests can use it too.
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";

export class TenantContextError extends Error {
  constructor(message = "No hospital context for this operation.") {
    super(message);
    this.name = "TenantContextError";
  }
}

const storage = new AsyncLocalStorage();

/** Run `fn` with a hospital context: { hospitalId, userId? }. */
export function runWithTenant(ctx, fn) {
  if (!ctx?.hospitalId || typeof ctx.hospitalId !== "string") throw new TenantContextError("A hospitalId is required.");
  // Await INSIDE the context: Prisma queries are lazy, so a query returned (not awaited) by fn would
  // otherwise execute after the context has ended.
  return storage.run({ hospitalId: ctx.hospitalId, userId: ctx.userId ?? null }, async () => await fn());
}

/** The explicit context of the current async call chain, if any (no request fallback). */
export function explicitTenantContext() {
  return storage.getStore() ?? null;
}

const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === "hospitalId")).map((m) => m.name),
);
export const isTenantModel = (model) => TENANT_MODELS.has(model);

const lcFirst = (s) => s[0].toLowerCase() + s.slice(1);

const WHERE_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany",
  "count", "aggregate", "groupBy",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

function assertNoForeignHospital(data, hospitalId, model) {
  for (const row of Array.isArray(data) ? data : [data]) {
    if (row && row.hospitalId !== undefined && row.hospitalId !== hospitalId) {
      throw new TenantContextError(`Refusing to write a ${model} row for a different hospital.`);
    }
  }
}

/** Application-level scoping: constrain every hospital-owned query to the current hospital. */
export function scopeArgs(model, operation, args, hospitalId) {
  if (!TENANT_MODELS.has(model)) return args;
  const a = { ...(args || {}) };
  if (WHERE_OPS.has(operation)) {
    const where = a.where || {};
    if (where.hospitalId !== undefined && where.hospitalId !== hospitalId) {
      throw new TenantContextError(`Refusing to query ${model} rows of a different hospital.`);
    }
    // findUnique/update/delete/upsert accept extra non-unique filters next to the unique key.
    a.where = { ...where, hospitalId };
  }
  if (CREATE_OPS.has(operation)) {
    if (operation === "upsert") {
      assertNoForeignHospital(a.create, hospitalId, model);
      assertNoForeignHospital(a.update, hospitalId, model);
    } else {
      assertNoForeignHospital(a.data, hospitalId, model);
    }
    // hospitalId itself is filled by the column default from the transaction's app.hospital_id.
  }
  return a;
}

function dispatch(client, model, operation, args) {
  if (!model) {
    // $queryRaw / $executeRaw receive a Prisma.Sql object; the *Unsafe variants an array of [sql, ...values].
    if (operation === "$queryRaw" || operation === "$executeRaw") return client[operation](args);
    if (Array.isArray(args)) return client[operation](...args);
    return client[operation](args);
  }
  return client[lcFirst(model)][operation](args);
}

/**
 * Build the hospital-scoped client.
 * @param {import("@prisma/client").PrismaClient} base   owner-role client (BYPASSRLS) — never exposed
 * @param {{ resolveContext?: () => Promise<{hospitalId:string,userId?:string}|null> }} options
 *        resolveContext: fallback used when no explicit context is active (e.g. Next.js pages read
 *        the hospital from the authenticated session).
 */
export function createTenantClient(base, { resolveContext } = {}) {
  async function requireContext() {
    const store = storage.getStore();
    if (store?.hospitalId) return store;
    const ctx = resolveContext ? await resolveContext() : null;
    if (!ctx?.hospitalId) throw new TenantContextError();
    return ctx;
  }

  const setContextSql = (hospitalId) =>
    Prisma.sql`SELECT set_config('role', 'hms_app', true), set_config('app.hospital_id', ${hospitalId}, true)`;

  // Run `fn(btx)` in one database transaction carrying the hospital context.
  async function inContextTransaction(ctx, fn, options) {
    return base.$transaction(async (btx) => {
      await btx.$executeRaw(setContextSql(ctx.hospitalId));
      return storage.run({ hospitalId: ctx.hospitalId, userId: ctx.userId ?? null, btx }, async () => await fn(btx));
    }, options);
  }

  const extended = base.$extends({
    query: {
      async $allOperations({ model, operation, args }) {
        const store = storage.getStore();
        const ctx = store?.btx ? store : await requireContext();
        const scoped = model ? scopeArgs(model, operation, args, ctx.hospitalId) : args;
        if (store?.btx) return dispatch(store.btx, model, operation, scoped);
        // Single operation: BEGIN; set context; query; COMMIT.
        const [, result] = await base.$transaction([
          base.$executeRaw(setContextSql(ctx.hospitalId)),
          dispatch(base, model, operation, scoped),
        ]);
        return result;
      },
    },
  });

  // `$transaction` is intercepted so interactive and batch transactions carry the context too.
  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return async (arg, options) => {
          const store = storage.getStore();
          if (store?.btx) {
            // Already inside a context transaction: join it.
            if (typeof arg === "function") return arg(receiver);
            const out = [];
            for (const p of arg) out.push(await p);
            return out;
          }
          const ctx = await requireContext();
          if (typeof arg === "function") return inContextTransaction(ctx, () => arg(receiver), options);
          // Batch form: PrismaPromises are lazy, so awaiting them inside the context routes them.
          return inContextTransaction(ctx, async () => {
            const out = [];
            for (const p of arg) out.push(await p);
            return out;
          }, options);
        };
      }
      if (prop === "$base") return undefined; // never expose the owner client through this one
      return Reflect.get(target, prop, receiver);
    },
  });
}
