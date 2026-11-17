// API-level multi-hospital isolation tests, driven through the real HTTP API of a running server that
// was seeded with the two demo hospitals (npm run seed). Never point this at production.
//
//   E2E_BASE_URL=http://localhost:3000 E2E_PASSWORD=<SEED_DEMO_PASSWORD> npm run test:e2e
//
// Every test signs in as real users of one hospital and attacks the other hospital's records by id,
// by search, by export, by switching hospital context and by forging a hospitalId in the request.
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.E2E_PASSWORD;
if (!PASSWORD) throw new Error("Set E2E_PASSWORD to the SEED_DEMO_PASSWORD used to seed the test database.");

class Client {
  constructor(name) { this.name = name; this.cookie = ""; this.ip = `10.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`; }
  async req(method, path, body, { raw } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: { origin: BASE, "x-forwarded-for": this.ip, ...(this.cookie ? { cookie: this.cookie } : {}), ...(body && !isForm ? { "content-type": "application/json" } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) { const m = set.match(/hms_session=([^;]*)/); if (m) this.cookie = m[1] ? `hms_session=${m[1]}` : ""; }
    if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
    const type = res.headers.get("content-type") || "";
    const json = type.includes("application/json") ? await res.json() : null;
    return { status: res.status, json, data: json?.data, meta: json?.meta };
  }
  get(p, o) { return this.req("GET", p, undefined, o); }
  post(p, b = {}) { return this.req("POST", p, b); }
  patch(p, b) { return this.req("PATCH", p, b); }
  async login(email) {
    const r = await this.post("/api/auth/login", { email, password: PASSWORD });
    if (r.status !== 200) throw new Error(`${this.name} login failed: ${r.status} ${JSON.stringify(r.json)}`);
    return this;
  }
}

const u = {};
const A = {}; // Demo General Hospital
const B = {}; // Central Hospital
const pdf = () => new Blob([Buffer.from("%PDF-1.4\n% synthetic test document\n%%EOF\n")], { type: "application/pdf" });

async function collect(client, h) {
  const s = await client.get("/api/auth/session");
  h.hospitalId = s.data.hospital.id;
  h.patients = (await client.get("/api/patients?pageSize=100")).data;
  h.appointments = (await client.get("/api/appointments?pageSize=50")).data;
  h.encounters = (await client.get("/api/encounters?pageSize=50")).data;
  h.invoices = (await client.get("/api/invoices?pageSize=50")).data;
  h.labOrders = (await client.get("/api/lab/orders?pageSize=50")).data;
  h.staff = (await client.get("/api/staff?pageSize=50")).data;
  h.users = (await client.get("/api/users?pageSize=100")).data;
  h.items = (await client.get("/api/inventory/items?pageSize=50")).data;
  h.admissions = (await client.get("/api/admissions?pageSize=50")).data;
}

beforeAll(async () => {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Server not reachable at ${BASE}. Start it first.`);
  const logins = {
    adminA: "admin@demo.hms", receptionA: "reception@demo.hms", labA: "lab@demo.hms", pharmacyA: "pharmacy@demo.hms", patientA: "patient@demo.hms",
    adminB: "central.admin@demo.hms", doctorB: "central.dr.khan@demo.hms", patientB: "central.patient@demo.hms",
    platform: "platform@demo.hms",
  };
  for (const [k, email] of Object.entries(logins)) u[k] = await new Client(k).login(email);
  await collect(u.adminA, A);
  await collect(u.adminB, B);
}, 120000);

describe("each hospital sees only its own data", () => {
  it("the two hospitals are different and both have data", () => {
    expect(A.hospitalId).toBeTruthy();
    expect(B.hospitalId).toBeTruthy();
    expect(A.hospitalId).not.toBe(B.hospitalId);
    for (const k of ["patients", "appointments", "encounters", "invoices", "labOrders", "staff", "users"]) {
      expect(A[k].length, `A ${k}`).toBeGreaterThan(0);
      expect(B[k].length, `B ${k}`).toBeGreaterThan(0);
    }
  });

  it("list endpoints never return the other hospital's records", () => {
    for (const k of ["patients", "appointments", "encounters", "invoices", "labOrders", "staff", "users", "items", "admissions"]) {
      const aIds = new Set(A[k].map((r) => r.id));
      expect(B[k].some((r) => aIds.has(r.id)), k).toBe(false);
    }
    const aEmails = new Set(A.users.map((x) => x.email));
    expect(B.users.some((x) => aEmails.has(x.email))).toBe(false);
  });
});

describe("hospital B cannot reach hospital A's records by id", () => {
  const cases = [
    ["patient", () => `/api/patients/${A.patients[0].id}`],
    ["appointment", () => `/api/appointments/${A.appointments[0].id}`],
    ["encounter", () => `/api/encounters/${A.encounters[0].id}`],
    ["invoice", () => `/api/invoices/${A.invoices[0].id}`],
    ["invoice pdf", () => `/api/invoices/${A.invoices[0].id}/pdf`],
    ["lab order", () => `/api/lab/orders/${A.labOrders[0].id}`],
    ["staff", () => `/api/staff/${A.staff[0].id}`],
    ["user", () => `/api/users/${A.users[0].id}`],
    ["inventory item", () => `/api/inventory/items/${A.items[0].id}`],
  ];
  for (const [label, path] of cases) {
    it(`GET ${label} → 404`, async () => {
      const r = await u.adminB.get(path(), { raw: true });
      expect(r.status).toBe(404);
      // Sanity: the owner can read it.
      expect((await u.adminA.get(path(), { raw: true })).status).toBe(200);
    });
  }

  it("cannot update, archive or pay hospital A's records", async () => {
    const p = A.patients[0];
    expect((await u.adminB.patch(`/api/patients/${p.id}`, { firstName: "Hacked", lastName: "Cross", sex: "UNKNOWN" })).status).toBe(404);
    expect((await u.adminB.post(`/api/patients/${p.id}/archive`, { archived: true, reason: "cross-hospital attempt" })).status).toBe(404);
    const inv = A.invoices.find((i) => ["ISSUED", "PARTIALLY_PAID"].includes(i.status)) ?? A.invoices[0];
    expect([404, 422]).toContain((await u.adminB.post(`/api/invoices/${inv.id}/payments`, { amount: "1.00", method: "CASH" })).status);
    expect((await u.adminB.post(`/api/invoices/${inv.id}/payments`, { amount: "1.00", method: "CASH" })).status).not.toBe(201);
    const after = await u.adminA.get(`/api/patients/${p.id}`);
    expect(after.data.firstName).not.toBe("Hacked");
  });

  it("cannot create records that reference hospital A's patient", async () => {
    const r = await u.adminB.post("/api/appointments/walk-in", { patientId: A.patients[0].id, doctorId: "x" });
    expect([400, 404, 422]).toContain(r.status);
  });
});

describe("search, exports and reports are hospital-scoped", () => {
  it("global search in B finds nothing of A", async () => {
    const target = A.patients.find((p) => p.phone) ?? A.patients[0];
    const r = await u.adminB.get(`/api/search?q=${encodeURIComponent(target.phone || target.lastName)}`);
    const hrefs = JSON.stringify(r.data ?? {});
    expect(hrefs.includes(target.id)).toBe(false);
  });

  it("patient CSV export of B contains no patient of A", async () => {
    const r = await u.adminB.get("/api/patients/export", { raw: true });
    expect(r.status).toBe(200);
    for (const p of A.patients.slice(0, 10)) if (p.phone) expect(r.text.includes(p.phone)).toBe(false);
  });

  it("reports in B are computed from B's data only", async () => {
    const list = await u.adminB.get("/api/reports");
    expect(list.status).toBe(200);
    const totalA = (await u.adminA.get("/api/patients?pageSize=10")).meta.total;
    const totalB = (await u.adminB.get("/api/patients?pageSize=10")).meta.total;
    expect(totalA).not.toBe(totalB);
    const dashB = await u.adminB.get("/api/dashboard");
    expect(dashB.status).toBe(200);
    expect(JSON.stringify(dashB.data)).not.toContain(A.patients[0].id);
  });

  it("audit log of B contains no events of A's users", async () => {
    const r = await u.adminB.get("/api/audit?pageSize=100");
    expect(r.status).toBe(200);
    const aUserIds = new Set(A.users.map((x) => x.id));
    expect(r.data.some((row) => aUserIds.has(row.userId))).toBe(false);
  });
});

describe("hospital context cannot be forged", () => {
  it("switching to a hospital without membership is refused", async () => {
    const r = await u.adminA.post("/api/auth/hospital", { hospitalId: B.hospitalId });
    expect(r.status).toBe(404);
    const s = await u.adminA.get("/api/auth/session");
    expect(s.data.hospital.id).toBe(A.hospitalId);
  });

  it("a hospitalId in the request body is ignored", async () => {
    const phone = `+92 300 ${String(Date.now()).slice(-7)}`;
    const r = await u.adminA.post("/api/patients", { firstName: "Forge", lastName: `Test${Date.now()}`, sex: "UNKNOWN", phone, hospitalId: B.hospitalId, confirmDuplicate: true });
    expect([200, 201]).toContain(r.status);
    const id = r.data.id ?? r.data.patient?.id;
    expect((await u.adminB.get(`/api/patients/${id}`)).status).toBe(404);
    expect((await u.adminA.get(`/api/patients/${id}`)).status).toBe(200);
  });
});

describe("document authorisation", () => {
  let labDoc;
  let portalPatientId;
  beforeAll(async () => {
    const mrn1 = A.patients.find((p) => p.mrn === "MRN-000001");
    portalPatientId = mrn1.id;
    const fd = new FormData();
    fd.set("file", pdf(), "lab-result.pdf");
    fd.set("patientId", portalPatientId);
    fd.set("category", "LAB_REPORT");
    const r = await u.labA.req("POST", "/api/documents", fd);
    expect(r.status).toBe(201);
    labDoc = r.data;
  });

  it("an authorised technician of the same hospital can download", async () => {
    const r = await u.labA.get(`/api/documents/${labDoc.id}`, { raw: true });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
  });

  it("patients:read alone does not allow downloading a lab report", async () => {
    expect((await u.receptionA.get(`/api/documents/${labDoc.id}`, { raw: true })).status).toBe(404);
    expect((await u.pharmacyA.get(`/api/documents/${labDoc.id}`, { raw: true })).status).toBe(404);
  });

  it("another hospital — even its Super Administrator — gets 404", async () => {
    expect((await u.adminB.get(`/api/documents/${labDoc.id}`, { raw: true })).status).toBe(404);
    expect((await u.doctorB.get(`/api/documents/${labDoc.id}`, { raw: true })).status).toBe(404);
  });

  it("a patient can download their own document but not another hospital's patient", async () => {
    expect((await u.patientA.get(`/api/documents/${labDoc.id}`, { raw: true })).status).toBe(200);
    expect((await u.patientB.get(`/api/documents/${labDoc.id}`, { raw: true })).status).toBe(404);
  });

  it("a patient cannot download another patient's document in the same hospital", async () => {
    const other = A.patients.find((p) => p.id !== portalPatientId);
    const fd = new FormData();
    fd.set("file", pdf(), "other.pdf"); fd.set("patientId", other.id); fd.set("category", "LAB_REPORT");
    const r = await u.labA.req("POST", "/api/documents", fd);
    expect(r.status).toBe(201);
    expect((await u.patientA.get(`/api/documents/${r.data.id}`, { raw: true })).status).toBe(404);
  });

  it("uploads are authorised per category", async () => {
    const mk = (cat, patientId = portalPatientId) => { const fd = new FormData(); fd.set("file", pdf(), "x.pdf"); fd.set("patientId", patientId); fd.set("category", cat); return fd; };
    expect((await u.pharmacyA.req("POST", "/api/documents", mk("OTHER"))).status).toBe(403);
    expect((await u.receptionA.req("POST", "/api/documents", mk("LAB_REPORT"))).status).toBe(403);
    expect((await u.receptionA.req("POST", "/api/documents", mk("ID_DOCUMENT"))).status).toBe(201);
    // B cannot attach a document to A's patient.
    expect((await u.adminB.req("POST", "/api/documents", mk("OTHER"))).status).toBe(404);
  });

  it("non-PDF/image content is rejected even with a PDF name", async () => {
    const fd = new FormData();
    fd.set("file", new Blob([Buffer.from("<script>alert(1)</script>")], { type: "application/pdf" }), "evil.pdf");
    fd.set("patientId", portalPatientId); fd.set("category", "LAB_REPORT");
    expect((await u.labA.req("POST", "/api/documents", fd)).status).toBe(400);
  });
});

describe("patients and the portal", () => {
  it("patient portal accounts cannot use staff APIs", async () => {
    expect((await u.patientA.get("/api/patients")).status).toBe(403);
    expect((await u.patientB.get("/api/invoices")).status).toBe(403);
  });
  it("each portal sees only its own record", async () => {
    const a = await u.patientA.get("/api/portal/profile");
    const b = await u.patientB.get("/api/portal/profile");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.data.id).not.toBe(b.data.id);
    expect(B.patients.some((p) => p.id === a.data.id)).toBe(false);
  });
});

describe("Platform Administrator", () => {
  it("can list hospitals but has no access to hospital data", async () => {
    const r = await u.platform.get("/api/platform/hospitals");
    expect(r.status).toBe(200);
    expect(r.data.map((h) => h.code)).toEqual(expect.arrayContaining(["DGH", "CEN"]));
    expect(JSON.stringify(r.data)).not.toMatch(/MRN-|firstName|diagnos/i);
    for (const path of ["/api/patients", "/api/invoices", "/api/audit", "/api/users", "/api/dashboard"]) {
      expect((await u.platform.get(path)).status, path).toBe(403);
    }
    expect((await u.platform.get(A.patients[0] ? `/api/patients/${A.patients[0].id}` : "/api/patients")).status).toBe(403);
  });

  it("hospital administrators cannot use platform endpoints", async () => {
    expect((await u.adminA.get("/api/platform/hospitals")).status).toBe(403);
    expect((await u.adminB.post("/api/platform/hospitals", { name: "Rogue", code: "ROGUE" })).status).toBe(403);
  });

  it("creates a hospital, appoints its admin, and deactivation cuts access immediately", async () => {
    const code = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const h = await u.platform.post("/api/platform/hospitals", { name: `Test Hospital ${code}`, code });
    expect(h.status).toBe(201);
    const email = `admin.${code.toLowerCase()}@example.test`;
    const a = await u.platform.post(`/api/platform/hospitals/${h.data.id}/admins`, { email, name: "Test Admin", role: "SUPER_ADMIN" });
    expect(a.status).toBe(201);
    expect(a.data.temporaryPassword).toBeTruthy();
    const c = new Client("newAdmin");
    const login = await c.post("/api/auth/login", { email, password: a.data.temporaryPassword });
    expect(login.status).toBe(200);
    expect((await c.post("/api/auth/change-password", { currentPassword: a.data.temporaryPassword, newPassword: `N3w-${crypto.randomUUID()}` })).status).toBe(200);
    const pats = await c.get("/api/patients?pageSize=5");
    expect(pats.status).toBe(200);
    expect(pats.meta.total).toBe(0); // a brand-new hospital sees no other hospital's patients
    expect((await c.get(`/api/patients/${A.patients[0].id}`)).status).toBe(404);
    const off = await u.platform.patch(`/api/platform/hospitals/${h.data.id}`, { active: false, reason: "e2e test" });
    expect(off.status).toBe(200);
    expect([401, 403]).toContain((await c.get("/api/patients")).status);
  });
});

describe("one account in two hospitals", () => {
  it("sees exactly one hospital's data at a time and switches only between its memberships", async () => {
    const email = "central.hadmin@demo.hms";
    const grant = await u.platform.post(`/api/platform/hospitals/${A.hospitalId}/admins`, { email, role: "HOSPITAL_ADMIN" });
    expect(grant.status).toBe(201);
    expect(grant.data.newAccount).toBe(false);
    expect(grant.data.temporaryPassword).toBeNull();

    const c = await new Client("shared").login(email);
    const s = await c.get("/api/auth/session");
    expect(s.data.hospitals.map((h) => h.id).sort()).toEqual([A.hospitalId, B.hospitalId].sort());

    const listIn = async (hospitalId) => {
      const sw = await c.post("/api/auth/hospital", { hospitalId });
      expect(sw.status).toBe(200);
      return (await c.get("/api/patients?pageSize=100")).data.map((p) => p.id);
    };
    const inA = await listIn(A.hospitalId);
    const inB = await listIn(B.hospitalId);
    const aIds = new Set(A.patients.map((p) => p.id));
    const bIds = new Set(B.patients.map((p) => p.id));
    expect(inA.some((id) => bIds.has(id))).toBe(false);
    expect(inB.some((id) => aIds.has(id))).toBe(false);
    expect(inA.length).toBeGreaterThan(0);
    expect(inB.length).toBeGreaterThan(0);
    // While working in B, A's records are unreachable by id.
    expect((await c.get(`/api/patients/${A.patients[0].id}`)).status).toBe(404);

    // A hospital administrator cannot reset the password of an account shared with another hospital.
    const users = (await u.adminA.get(`/api/users?q=${encodeURIComponent(email)}`)).data;
    const shared = users.find((x) => x.email === email);
    expect(shared).toBeTruthy();
    expect((await u.adminA.post(`/api/users/${shared.id}/reset-password`, {})).status).toBe(403);
  });
});
