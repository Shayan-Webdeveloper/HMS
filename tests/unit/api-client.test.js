import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const { api } = await import("@/components/ui/api-client.js");

function respond(status, body) {
  return vi.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }));
}

describe("api() 401 handling", () => {
  let assign;
  beforeEach(() => {
    assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("redirects to the session-expired login page when the session is gone", async () => {
    vi.stubGlobal("fetch", respond(401, { ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication required" } }));
    await expect(api("/api/patients")).rejects.toThrow("Authentication required");
    expect(assign).toHaveBeenCalledWith("/login?expired=1");
  });

  it("does not treat a wrong email/password as an expired session", async () => {
    vi.stubGlobal("fetch", respond(401, { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." } }));
    await expect(api("/api/auth/login", { method: "POST", body: { email: "a@b.c", password: "x" } })).rejects.toThrow("Incorrect email or password.");
    expect(assign).not.toHaveBeenCalled();
  });
});
