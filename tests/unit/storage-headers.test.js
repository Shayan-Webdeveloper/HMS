import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Supabase Storage authentication headers for both key formats. Fake keys only; fetch is stubbed,
// so no request leaves the test and no real secret is read (dotenv is mocked for the script).
//   * legacy service_role JWT  → apikey + Authorization: Bearer (unchanged behaviour)
//   * new secret key sb_secret_ → apikey only (it is not a JWT and must not be sent as Bearer)

vi.mock("dotenv/config", () => ({}));

const LEGACY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake-test-signature";
const SECRET = "sb_secret_TEST_ONLY_not_a_real_key";
const HOSPITAL = "hospital_test_0001";
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

const { storageAuthHeaders, putFile, getFile, removeFile } = await import("@/lib/storage/index.js");

let calls;
function stubFetch(json = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: { ...(init.headers || {}) } });
    return { ok: true, status: 200, json: async () => json, arrayBuffer: async () => new Uint8Array(PDF).buffer };
  }));
}

function useKey(key) {
  vi.stubEnv("FILE_STORAGE_PROVIDER", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", "hms-documents");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", key);
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("storageAuthHeaders()", () => {
  it("keeps apikey + Authorization: Bearer for a legacy service_role JWT", () => {
    expect(storageAuthHeaders(LEGACY)).toEqual({ apikey: LEGACY, Authorization: `Bearer ${LEGACY}` });
  });

  it("sends a new sb_secret_ key on the apikey header only", () => {
    const h = storageAuthHeaders(SECRET);
    expect(h).toEqual({ apikey: SECRET });
    expect(h).not.toHaveProperty("Authorization");
  });
});

describe.each([
  ["legacy service_role JWT", LEGACY, { apikey: LEGACY, Authorization: `Bearer ${LEGACY}` }],
  ["new sb_secret_ key", SECRET, { apikey: SECRET }],
])("Storage requests with a %s", (_label, key, auth) => {
  beforeEach(() => { useKey(key); stubFetch(); });

  it("upload sends the right auth headers plus content type and no-overwrite", async () => {
    const { key: objectKey } = await putFile(PDF, "application/pdf", { hospitalId: HOSPITAL });
    expect(objectKey.startsWith(`${HOSPITAL}/`)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers).toEqual({ ...auth, "Content-Type": "application/pdf", "x-upsert": "false" });
  });

  it("download sends exactly the auth headers", async () => {
    await getFile(`${HOSPITAL}/2026-11/x.pdf`, { hospitalId: HOSPITAL });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers).toEqual(auth);
  });

  it("cleanup delete sends the auth headers plus JSON content type", async () => {
    await removeFile(`${HOSPITAL}/2026-11/x.pdf`, { hospitalId: HOSPITAL });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].headers).toEqual({ ...auth, "Content-Type": "application/json" });
  });
});

describe.each([
  ["legacy service_role JWT", LEGACY, { apikey: LEGACY, Authorization: `Bearer ${LEGACY}` }],
  ["new sb_secret_ key", SECRET, { apikey: SECRET }],
])("scripts/storage-setup.js with a %s", (_label, key, auth) => {
  it("checks the bucket with the right headers", async () => {
    useKey(key);
    stubFetch({ public: false });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    await import("../../scripts/storage-setup.js");
    log.mockRestore();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].url).toBe("https://project.supabase.test/storage/v1/bucket/hms-documents");
    expect(calls[0].headers).toEqual({ ...auth, "Content-Type": "application/json" });
  });
});
