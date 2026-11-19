import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

// Notifications belong to a hospital. A signed-in user WITHOUT a hospital context (a Platform
// Administrator, or someone whose memberships are all inactive) must get an empty result — not a
// tenant-guard error. Seen in production: an open hospital tab kept polling /api/notifications after
// the browser signed in as a Platform Administrator, logging "[tenant] operation without a valid
// hospital context" every minute.

const state = vi.hoisted(() => ({ session: null }));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => state.session,
  can: () => true,
  clientIp: () => null,
}));
vi.mock("@/lib/db/prisma", () => {
  class TenantContextError extends Error {}
  const store = new AsyncLocalStorage();
  // Behaves like the real hospital-scoped client: refuses to run outside a hospital context.
  const guarded = (result) => vi.fn(async () => {
    if (!store.getStore()?.hospitalId) throw new TenantContextError("No hospital context for this operation.");
    return result;
  });
  return {
    TenantContextError,
    runWithTenant: (ctx, fn) => store.run(ctx, fn),
    prisma: { notification: { findMany: guarded([{ id: "n1" }]), count: guarded(1), updateMany: guarded({ count: 1 }) } },
  };
});

const { prisma } = await import("@/lib/db/prisma");
const list = await import("@/app/api/notifications/route.js");
const readAll = await import("@/app/api/notifications/read-all/route.js");
const readOne = await import("@/app/api/notifications/[id]/read/route.js");

const user = { id: "u1", email: "x@example.com", name: "X", mustChangePassword: false };
const noHospital = { user, hospitalId: null, isPlatformAdmin: true, isPatient: false, permissions: new Set() };
const inHospital = { user, hospitalId: "hospital-1", isPlatformAdmin: false, isPatient: false, permissions: new Set() };
const get = (url) => new Request(url);
const post = (url) => new Request(url, { method: "POST" });

describe("notifications API without a hospital context", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("GET returns an empty list instead of a tenant error", async () => {
    state.session = noHospital;
    const res = await list.GET(get("http://localhost:3000/api/notifications?limit=8"), {});
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ items: [], unread: 0 });
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("read-all updates nothing", async () => {
    state.session = noHospital;
    const res = await readAll.POST(post("http://localhost:3000/api/notifications/read-all"), {});
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ updated: 0 });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("marking one as read is a plain 404", async () => {
    state.session = noHospital;
    const res = await readOne.POST(post("http://localhost:3000/api/notifications/n1/read"), { params: Promise.resolve({ id: "n1" }) });
    expect(res.status).toBe(404);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("still lists the user's notifications inside a hospital", async () => {
    state.session = inHospital;
    const res = await list.GET(get("http://localhost:3000/api/notifications"), {});
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ items: [{ id: "n1" }], unread: 1 });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }) }));
  });
});
