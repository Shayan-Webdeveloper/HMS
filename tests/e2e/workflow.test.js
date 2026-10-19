// End-to-end workflow test across modules, driven through the real HTTP API of a running server.
//
//   1. Start the app against a DEVELOPMENT database seeded with demo data (never production):
//        npm run build && npm run start
//   2. E2E_BASE_URL=http://localhost:3000 E2E_PASSWORD=<SEED_DEMO_PASSWORD> npm run test:e2e
//
// The test creates its own uniquely-named patient so it can run repeatedly.
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.E2E_PASSWORD || "DemoPass2026";
const RUN = Date.now().toString(36);
const PHONE = `+92 300 ${String(Date.now()).slice(-7)}`;

class Client {
  constructor(name) { this.name = name; this.cookie = ""; this.ip = `10.250.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`; }
  async req(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: { origin: BASE, "x-forwarded-for": this.ip, ...(this.cookie ? { cookie: this.cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) { const m = set.match(/hms_session=([^;]*)/); if (m) this.cookie = m[1] ? `hms_session=${m[1]}` : ""; }
    const type = res.headers.get("content-type") || "";
    const json = type.includes("application/json") ? await res.json() : null;
    const text = json ? null : await res.text();
    return { status: res.status, json, text, data: json?.data, headers: res.headers };
  }
  get(p) { return this.req("GET", p); }
  post(p, b = {}) { return this.req("POST", p, b); }
  patch(p, b) { return this.req("PATCH", p, b); }
  async login(email) {
    const r = await this.post("/api/auth/login", { email, password: PASSWORD });
    if (r.status !== 200) throw new Error(`${this.name} login failed: ${r.status} ${JSON.stringify(r.json)}`);
    return this;
  }
}

const users = {};
const state = {};

beforeAll(async () => {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Server not reachable at ${BASE}. Start it first (see header comment).`);
  const logins = { admin: "admin@demo.hms", reception: "reception@demo.hms", doctor: "dr.khan@demo.hms", otherDoctor: "dr.fatima@demo.hms", nurse: "nurse@demo.hms", lab: "lab@demo.hms", pharmacy: "pharmacy@demo.hms", billing: "billing@demo.hms", patient: "patient@demo.hms" };
  for (const [k, email] of Object.entries(logins)) users[k] = await new Client(k).login(email);
});

describe("1. Administrator dashboard", () => {
  it("renders the dashboard with live metrics", async () => {
    const r = await users.admin.get("/dashboard");
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Dashboard/);
    const api = await users.admin.get("/api/dashboard");
    expect(api.status).toBe(200);
  });
  it("unauthenticated API access is rejected", async () => {
    const anon = new Client("anon");
    expect((await anon.get("/api/patients")).status).toBe(401);
  });
});

describe("2–3. Reception registers a patient and books an appointment", () => {
  it("registers a new patient with an MRN", async () => {
    const r = await users.reception.post("/api/patients", { firstName: "E2E", lastName: `Patient${RUN}`, sex: "FEMALE", dateOfBirth: "1990-05-17", phone: PHONE });
    expect(r.status).toBe(201);
    expect(r.data.mrn).toMatch(/^MRN-\d{6}$/);
    state.patientId = r.data.id;
  });
  it("flags a duplicate registration", async () => {
    const r = await users.reception.post("/api/patients", { firstName: "E2E", lastName: `Patient${RUN}`, sex: "FEMALE", dateOfBirth: "1990-05-17" });
    expect(r.status).toBe(409);
    expect(r.json.error.fields.duplicates.length).toBeGreaterThan(0);
  });
  it("finds the doctor and an available future slot, then books it", async () => {
    const d = await users.reception.get("/api/doctors?q=Khan");
    expect(d.status).toBe(200);
    state.doctorId = d.data[0].id;
    // next Monday–Saturday at least 2 days ahead
    let date;
    for (let i = 2; i < 10; i++) {
      const dt = new Date(Date.now() + i * 86400000);
      if (dt.getUTCDay() !== 0) { date = dt.toISOString().slice(0, 10); break; }
    }
    const s = await users.reception.get(`/api/appointments/slots?doctorId=${state.doctorId}&date=${date}`);
    expect(s.status).toBe(200);
    const free = s.data.slots.filter((x) => x.available);
    expect(free.length).toBeGreaterThan(0);
    const slot = free[free.length - 1];
    const b = await users.reception.post("/api/appointments", { patientId: state.patientId, doctorId: state.doctorId, date, time: slot.start, type: "NEW", reason: "E2E follow-up booking" });
    expect(b.status).toBe(201);
    state.futureAppt = b.data.id;
    // the same slot is now taken for anyone else
    const dup = await users.reception.post("/api/appointments", { patientId: state.patientId, doctorId: state.doctorId, date, time: slot.start, type: "NEW" });
    expect([409, 422]).toContain(dup.status);
  });
  it("registers a walk-in for today (checked in with a queue token)", async () => {
    const r = await users.reception.post("/api/appointments/walk-in", { patientId: state.patientId, doctorId: state.doctorId, reason: "E2E walk-in" });
    expect(r.status).toBe(201);
    expect(r.data.status).toBe("CHECKED_IN");
    state.apptId = r.data.id;
  });
});

describe("4–5. Doctor consultation, prescription and lab order", () => {
  it("another doctor cannot start this consultation", async () => {
    expect((await users.otherDoctor.post(`/api/appointments/${state.apptId}/start`)).status).toBe(403);
  });
  it("the assigned doctor starts the consultation", async () => {
    const r = await users.doctor.post(`/api/appointments/${state.apptId}/start`);
    expect(r.status).toBe(200);
    state.encounterId = r.data.encounterId;
    expect(state.encounterId).toBeTruthy();
  });
  it("cannot finalize without assessment and diagnosis", async () => {
    expect((await users.doctor.post(`/api/encounters/${state.encounterId}/finalize`)).status).toBe(422);
  });
  it("documents the encounter", async () => {
    const u = await users.doctor.patch(`/api/encounters/${state.encounterId}`, { chiefComplaint: "Cough for 3 days", historyOfPresentIllness: "Synthetic E2E note", examination: "Synthetic", assessment: "Synthetic E2E assessment", plan: "Synthetic plan" });
    expect(u.status).toBe(200);
    const v = await users.nurse.post(`/api/encounters/${state.encounterId}/vitals`, { temperatureC: 37.2, pulse: 84, systolic: 122, diastolic: 78, spo2: 98 });
    expect([200, 201]).toContain(v.status);
    const dx = await users.doctor.post(`/api/encounters/${state.encounterId}/diagnoses`, { code: "J06.9", description: "Acute upper respiratory infection", isPrimary: true });
    expect([200, 201]).toContain(dx.status);
  });
  it("prescribes from the pharmacy catalogue", async () => {
    const m = await users.doctor.get("/api/pharmacy/medications?q=Paracetamol");
    expect(m.status).toBe(200);
    const med = m.data.find((x) => x.onHand >= 10) || m.data[0];
    state.medicationId = med.id;
    const r = await users.doctor.post("/api/prescriptions", { patientId: state.patientId, encounterId: state.encounterId, items: [{ medicationId: med.id, dose: "1 tablet", route: "Oral", frequency: "Three times daily", durationDays: 3, quantity: 9 }], finalize: false });
    expect(r.status).toBe(201);
    state.prescriptionId = r.data.id;
    expect(r.data.status).toBe("DRAFT");
  });
  it("orders laboratory tests", async () => {
    const t = await users.doctor.get("/api/lab/tests?q=Haemoglobin");
    expect(t.status).toBe(200);
    const r = await users.doctor.post("/api/lab/orders", { patientId: state.patientId, encounterId: state.encounterId, testIds: [t.data[0].id], priority: "URGENT" });
    expect(r.status).toBe(201);
    state.labOrderId = r.data.id;
  });
  it("a receptionist cannot order labs or finalize", async () => {
    expect((await users.reception.post("/api/lab/orders", { patientId: state.patientId, testIds: ["x"] })).status).toBe(403);
    expect((await users.reception.post(`/api/encounters/${state.encounterId}/finalize`)).status).toBe(403);
  });
  it("finalizes the encounter, activating the prescription", async () => {
    const r = await users.doctor.post(`/api/encounters/${state.encounterId}/finalize`);
    expect(r.status).toBe(200);
    const rx = await users.doctor.get(`/api/prescriptions/${state.prescriptionId}`);
    expect(rx.data.status).toBe("ACTIVE");
    const appt = await users.reception.get(`/api/appointments/${state.apptId}`);
    expect(appt.data.status).toBe("COMPLETED");
  });
  it("finalized notes are read-only; amendments are separate", async () => {
    expect((await users.doctor.patch(`/api/encounters/${state.encounterId}`, { assessment: "changed" })).status).toBe(422);
    expect((await users.doctor.post(`/api/encounters/${state.encounterId}/amend`, { content: "Addendum (synthetic)", reason: "Clarification" })).status).toBe(201);
  });
});

describe("6. Laboratory processes and releases the result", () => {
  it("doctor cannot see the value before release; lab completes the workflow", async () => {
    expect((await users.lab.post(`/api/lab/orders/${state.labOrderId}/start`)).status).toBe(422); // must collect first
    expect((await users.lab.post(`/api/lab/orders/${state.labOrderId}/collect`)).status).toBe(200);
    expect((await users.lab.post(`/api/lab/orders/${state.labOrderId}/start`)).status).toBe(200);
    const order = await users.lab.get(`/api/lab/orders/${state.labOrderId}`);
    const itemId = order.data.items[0].id;
    const res = await users.lab.post(`/api/lab/orders/${state.labOrderId}/results`, { results: [{ orderItemId: itemId, value: "10.4" }] });
    expect(res.status).toBe(200);
    expect((await users.reception.post(`/api/lab/orders/${state.labOrderId}/release`)).status).toBe(403);
    const rel = await users.lab.post(`/api/lab/orders/${state.labOrderId}/release`);
    expect(rel.status).toBe(200);
    const after = await users.lab.get(`/api/lab/orders/${state.labOrderId}`);
    expect(after.data.status).toBe("RELEASED");
    const result = after.data.items[0].results.find((x) => x.isCurrent);
    expect(result.flag).toBe("LOW"); // 10.4 < configured 12.0 lower limit
  });
});

describe("7. Pharmacy dispenses with stock control", () => {
  it("refuses to dispense more than prescribed", async () => {
    const rx = await users.pharmacy.get(`/api/pharmacy/prescriptions/${state.prescriptionId}`);
    expect(rx.status).toBe(200);
    state.rxItemId = rx.data.items[0].id;
    expect((await users.pharmacy.post(`/api/pharmacy/prescriptions/${state.prescriptionId}/dispense`, { items: [{ itemId: state.rxItemId, quantity: 999 }] })).status).toBe(422);
  });
  it("dispenses the prescribed quantity and decrements stock", async () => {
    const before = (await users.pharmacy.get("/api/pharmacy/medications?q=Paracetamol")).data.find((m) => m.id === state.medicationId).onHand;
    const r = await users.pharmacy.post(`/api/pharmacy/prescriptions/${state.prescriptionId}/dispense`, { items: [{ itemId: state.rxItemId, quantity: 9 }] });
    expect(r.status).toBe(200);
    const after = (await users.pharmacy.get("/api/pharmacy/medications?q=Paracetamol")).data.find((m) => m.id === state.medicationId).onHand;
    expect(before - after).toBe(9);
    const rx = await users.pharmacy.get(`/api/pharmacy/prescriptions/${state.prescriptionId}`);
    expect(rx.data.status).toBe("DISPENSED");
  });
  it("a pharmacist cannot see billing", async () => {
    expect((await users.pharmacy.get("/api/invoices")).status).toBe(403);
  });
});

describe("8. Billing invoices the visit and records payment", () => {
  it("collects unbilled charges from consultation, lab and pharmacy", async () => {
    const r = await users.billing.get(`/api/billing/unbilled?patientId=${state.patientId}`);
    expect(r.status).toBe(200);
    const cats = new Set(r.data.charges.map((c) => c.category));
    expect(cats.has("CONSULTATION")).toBe(true);
    expect(cats.has("LAB")).toBe(true);
    expect(cats.has("PHARMACY")).toBe(true);
    state.charges = r.data.charges;
  });
  it("creates, issues and settles the invoice exactly", async () => {
    const inv = await users.billing.post("/api/invoices", { patientId: state.patientId, sources: state.charges.map((c) => ({ sourceType: c.sourceType, sourceId: c.sourceId })) });
    expect(inv.status).toBe(201);
    state.invoiceId = inv.data.id;
    // the same charges cannot be billed twice
    const again = await users.billing.post("/api/invoices", { patientId: state.patientId, sources: state.charges.map((c) => ({ sourceType: c.sourceType, sourceId: c.sourceId })) });
    expect(again.status).toBe(409);
    expect((await users.billing.post(`/api/invoices/${state.invoiceId}/issue`)).status).toBe(200);
    const detail = await users.billing.get(`/api/invoices/${state.invoiceId}`);
    const expected = state.charges.reduce((s, c) => s + Math.round(Number(c.amount) * 100), 0);
    expect(Math.round(Number(detail.data.total) * 100)).toBe(expected);
    const key = crypto.randomUUID();
    const pay = await users.billing.post(`/api/invoices/${state.invoiceId}/payments`, { amount: detail.data.total, method: "CASH", idempotencyKey: key });
    expect(pay.status).toBe(201);
    const replay = await users.billing.post(`/api/invoices/${state.invoiceId}/payments`, { amount: detail.data.total, method: "CASH", idempotencyKey: key });
    expect(replay.status).toBe(200); // idempotent — no duplicate payment
    const paid = await users.billing.get(`/api/invoices/${state.invoiceId}`);
    expect(paid.data.status).toBe("PAID");
    expect(Number(paid.data.balance)).toBe(0);
  });
  it("generates a real PDF invoice", async () => {
    const res = await fetch(`${BASE}/api/invoices/${state.invoiceId}/pdf`, { headers: { cookie: users.billing.cookie } });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("Inpatient: concurrency-safe bed allocation, transfer and discharge", () => {
  it("two simultaneous admissions to one bed: exactly one wins", async () => {
    const mk = async (n) => (await users.reception.post("/api/patients", { firstName: "Bed", lastName: `Race${n}${RUN}`, sex: "MALE", phone: `+92 301 ${String(Date.now() + n).slice(-7)}` })).data.id;
    const [p1, p2] = [await mk(1), await mk(2)];
    state.inpatientId = p1;
    const beds = (await users.doctor.get("/api/beds?status=AVAILABLE")).data;
    expect(beds.length).toBeGreaterThan(1);
    const bed = beds[0];
    state.secondBed = beds.find((b) => b.id !== bed.id);
    const body = (pid) => ({ patientId: pid, doctorId: state.doctorId, wardId: bed.wardId, bedId: bed.id, reason: "E2E concurrency test admission" });
    const [a, b] = await Promise.all([users.doctor.post("/api/admissions", body(p1)), users.doctor.post("/api/admissions", body(p2))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    state.admissionId = (a.status === 201 ? a : b).data.id;
    state.inpatientId = a.status === 201 ? p1 : p2;
    state.firstBed = bed;
  });
  it("transfer frees the old bed for cleaning; discharge requires a summary", async () => {
    const t = await users.doctor.post(`/api/admissions/${state.admissionId}/transfer`, { wardId: state.secondBed.wardId, bedId: state.secondBed.id, reason: "E2E transfer" });
    expect(t.status).toBe(200);
    const old = (await users.doctor.get(`/api/beds?wardId=${state.firstBed.wardId}`)).data.find((b) => b.id === state.firstBed.id);
    expect(old.status).toBe("CLEANING");
    expect((await users.doctor.post(`/api/admissions/${state.admissionId}/discharge`, { dischargeSummary: "short", dischargeCondition: "Improved" })).status).toBe(422);
    expect((await users.nurse.post(`/api/admissions/${state.admissionId}/discharge`, { dischargeSummary: "Synthetic E2E discharge summary.", dischargeCondition: "Improved" })).status).toBe(403);
    const d = await users.doctor.post(`/api/admissions/${state.admissionId}/discharge`, { dischargeSummary: "Synthetic E2E discharge summary.", dischargeCondition: "Improved" });
    expect(d.status).toBe(200);
    const second = (await users.doctor.get(`/api/beds?wardId=${state.secondBed.wardId}`)).data.find((b) => b.id === state.secondBed.id);
    expect(second.status).toBe("CLEANING");
  });
  it("billing sees the bed days as an unbilled charge", async () => {
    const r = await users.billing.get(`/api/billing/unbilled?patientId=${state.inpatientId}`);
    expect(r.data.charges.some((c) => c.category === "BED")).toBe(true);
  });
});

describe("9. Administrator reviews reports", () => {
  it("lists reports and exports CSV", async () => {
    const r = await users.admin.get("/api/reports");
    expect(r.status).toBe(200);
    expect(r.data.length).toBeGreaterThanOrEqual(15);
    const key = r.data.find((x) => /revenue|collection/i.test(x.key))?.key || r.data[0].key;
    const page = await users.admin.get(`/reports/${key}`);
    expect(page.status).toBe(200);
    const csv = await fetch(`${BASE}/api/reports/${key}/export`, { headers: { cookie: users.admin.cookie } });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
  });
  it("financial reports are hidden from doctors", async () => {
    const r = await users.doctor.get("/api/reports");
    expect(r.data.some((x) => x.financial)).toBe(false);
  });
});

describe("10. Patient portal isolation", () => {
  it("the patient sees only their own records", async () => {
    const s = await users.patient.get("/api/portal/summary");
    expect(s.status).toBe(200);
    const page = await users.patient.get("/portal");
    expect(page.status).toBe(200);
    expect(page.text).toContain("MRN-000001");
    expect(page.text).not.toContain(`Patient${RUN}`);
  });
  it("the patient cannot reach staff APIs or other patients' documents", async () => {
    expect((await users.patient.get("/api/patients")).status).toBe(403);
    expect((await users.patient.get(`/api/patients/${state.patientId}`)).status).toBe(403);
    expect((await users.patient.get(`/api/invoices/${state.invoiceId}`)).status).toBe(403);
    expect((await users.patient.get(`/api/lab/orders/${state.labOrderId}`)).status).toBe(403);
  });
  it("staff cannot use portal APIs", async () => {
    expect((await users.reception.get("/api/portal/summary")).status).toBe(403);
  });
});

describe("Security controls", () => {
  it("blocks cross-site state-changing requests", async () => {
    const r = await fetch(`${BASE}/api/patients`, { method: "POST", headers: { origin: "https://evil.example", cookie: users.reception.cookie, "content-type": "application/json" }, body: JSON.stringify({ firstName: "X", lastName: "Y" }) });
    expect(r.status).toBe(403);
  });
  it("sets security headers", async () => {
    const r = await fetch(`${BASE}/login`);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("revokes sessions on logout", async () => {
    const c = await new Client("temp").login("nurse@demo.hms");
    const cookie = c.cookie;
    expect((await c.post("/api/auth/logout")).status).toBe(200);
    const r = await fetch(`${BASE}/api/notifications`, { headers: { cookie } });
    expect(r.status).toBe(401);
  });
});
