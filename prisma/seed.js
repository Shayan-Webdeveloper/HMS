// DEMONSTRATION DATA seed — synthetic records only. Never run against production.
//
//   npm run seed                  (wipes and re-creates demo data in DATABASE_URL)
//   SEED_DEMO_PASSWORD=...        password for every demo account (random if unset; printed once)
//
import "dotenv/config";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../lib/db/client-factory.js";
import { ROLES, PERMISSIONS } from "../lib/permissions/matrix.js";
import { newId } from "../lib/ids.js";
import { calcInvoiceTotals, calcLine } from "../lib/utils/money.js";
import { zonedToUtc, addDays, todayInTz, weekdayOf } from "../lib/utils/time.js";

const TZ = "Asia/Karachi";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--i-understand-this-wipes-data")) {
  console.error("Refusing to seed with NODE_ENV=production. Demo data must never be loaded into a production database.");
  process.exit(1);
}

const prisma = createPrismaClient(process.env.SEED_DATABASE_URL || process.env.DATABASE_URL);

// Deterministic pseudo-random generator so the demo data is reproducible.
let seedState = 20261009;
function rnd() { seedState = (seedState * 1664525 + 1013904223) % 4294967296; return seedState / 4294967296; }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

async function wipe() {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

const FIRST_M = ["Ahmed", "Bilal", "Usman", "Hamza", "Imran", "Kamran", "Faisal", "Zubair", "Omar", "Saad", "Hassan", "Junaid", "Tariq", "Adeel", "Waqas"];
const FIRST_F = ["Ayesha", "Fatima", "Sana", "Hira", "Maryam", "Zainab", "Amna", "Nida", "Rabia", "Sadia", "Mahnoor", "Iqra", "Saima", "Khadija", "Noor"];
const LAST = ["Khan", "Ahmed", "Malik", "Hussain", "Qureshi", "Butt", "Sheikh", "Chaudhry", "Raza", "Siddiqui", "Mirza", "Abbasi", "Javed", "Iqbal", "Rana"];
const CITIES = ["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Faisalabad", "Multan"];

async function main() {
  console.log("Seeding DEMONSTRATION DATA…");
  await wipe();

  const demoPassword = process.env.SEED_DEMO_PASSWORD || crypto.randomBytes(9).toString("base64url") + "7a";
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  // ── Hospital & settings ──────────────────────────────────
  const hospital = await prisma.hospital.create({
    data: { name: "Demo General Hospital", code: "DGH", address: "12 Example Road, Lahore (DEMONSTRATION DATA)", phone: "+92 42 0000 0000", email: "info@demo.hms", timezone: TZ, currency: "PKR", locale: "en-PK" },
  });
  const facility = await prisma.facility.create({ data: { hospitalId: hospital.id, name: "Main Campus", code: "MAIN" } });
  await prisma.systemSetting.createMany({
    data: [
      { hospitalId: hospital.id, key: "hospital.profile", value: { name: "Demo General Hospital", logoText: "DGH" } },
      { hospitalId: hospital.id, key: "billing", value: { taxRatePercent: "0", paymentMethods: ["CASH", "CARD", "BANK_TRANSFER"], maxDiscountPercentWithoutApproval: 10 } },
      { hospitalId: hospital.id, key: "imaging.catalog", value: { items: [
        { code: "XR-CHEST", modality: "XRAY", bodyPart: "Chest PA", price: "1500.00" },
        { code: "XR-KNEE", modality: "XRAY", bodyPart: "Knee AP/Lat", price: "1800.00" },
        { code: "US-ABD", modality: "US", bodyPart: "Abdomen & pelvis", price: "3000.00" },
        { code: "CT-HEAD", modality: "CT", bodyPart: "Head (non-contrast)", price: "9000.00" },
        { code: "MRI-LSP", modality: "MRI", bodyPart: "Lumbar spine", price: "18000.00" },
      ] } },
      { hospitalId: hospital.id, key: "services.catalog", value: { items: [
        { code: "SVC-DRESS", category: "MISC", name: "Wound dressing", price: "800.00" },
        { code: "SVC-ECG", category: "MISC", name: "ECG", price: "1200.00" },
        { code: "SVC-NEB", category: "MISC", name: "Nebulisation", price: "500.00" },
        { code: "SVC-INJ", category: "MISC", name: "Injection administration", price: "300.00" },
      ] } },
    ],
  });

  // ── Roles & permissions ──────────────────────────────────
  const permRows = {};
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    const [resource, action] = key.split(":");
    permRows[key] = await prisma.permission.create({ data: { key, resource, action, description } });
  }
  const roleRows = {};
  for (const [key, r] of Object.entries(ROLES)) {
    roleRows[key] = await prisma.role.create({ data: { key, name: r.name, description: r.description } });
    await prisma.rolePermission.createMany({ data: r.permissions.map((p) => ({ roleId: roleRows[key].id, permissionId: permRows[p].id })) });
  }

  // ── Departments ──────────────────────────────────────────
  const deptDefs = [
    ["GM", "General Medicine", true], ["PED", "Pediatrics", true], ["CAR", "Cardiology", true], ["ORT", "Orthopedics", true],
    ["GYN", "Obstetrics & Gynecology", true], ["ER", "Emergency", true], ["LAB", "Laboratory", true], ["RAD", "Radiology", true],
    ["PHR", "Pharmacy", false], ["ADM", "Administration", false], ["FIN", "Finance", false], ["NUR", "Nursing", true],
  ];
  const dept = {};
  for (const [code, name, isClinical] of deptDefs) dept[code] = await prisma.department.create({ data: { hospitalId: hospital.id, code, name, isClinical } });

  // ── Users & staff ────────────────────────────────────────
  async function makeUser({ email, first, last, role, deptCode, position, doctor }) {
    const user = await prisma.user.create({ data: { email, name: `${first} ${last}`, passwordHash, roles: { create: [{ roleId: roleRows[role].id }] } } });
    if (role === "PATIENT") return { user };
    const staff = await prisma.staff.create({
      data: {
        employeeNo: await newId(prisma, "employee"), userId: user.id, firstName: first, lastName: last, email, phone: `+92 300 ${int(1000000, 9999999)}`,
        departmentId: dept[deptCode].id, position, joiningDate: new Date(Date.UTC(2020 + int(0, 5), int(0, 11), int(1, 28))), shift: pick(["MORNING", "EVENING"]),
        emergencyContactName: `${pick(FIRST_M)} ${last}`, emergencyContactPhone: `+92 301 ${int(1000000, 9999999)}`,
      },
    });
    let doctorProfile = null;
    if (doctor) {
      doctorProfile = await prisma.doctorProfile.create({
        data: { staffId: staff.id, departmentId: dept[deptCode].id, specialty: doctor.specialty, qualifications: doctor.qualifications, licenseNumber: doctor.license, consultationFee: doctor.fee, slotMinutes: doctor.slot ?? 15 },
      });
      // Mon–Sat 09:00–13:00 and 14:00–17:00 (hospital local time)
      const avail = [];
      for (let wd = 1; wd <= 6; wd++) { avail.push({ doctorId: doctorProfile.id, weekday: wd, startTime: "09:00", endTime: "13:00" }); if (wd !== 6) avail.push({ doctorId: doctorProfile.id, weekday: wd, startTime: "14:00", endTime: "17:00" }); }
      await prisma.doctorAvailability.createMany({ data: avail });
    }
    return { user, staff, doctorProfile };
  }

  const admin = await makeUser({ email: "admin@demo.hms", first: "System", last: "Administrator", role: "SUPER_ADMIN", deptCode: "ADM", position: "IT Administrator" });
  const hadmin = await makeUser({ email: "hadmin@demo.hms", first: "Nadia", last: "Rehman", role: "HOSPITAL_ADMIN", deptCode: "ADM", position: "Hospital Administrator" });
  const reception = await makeUser({ email: "reception@demo.hms", first: "Sana", last: "Javed", role: "RECEPTIONIST", deptCode: "ADM", position: "Front Desk Officer" });
  const doctors = [
    await makeUser({ email: "dr.khan@demo.hms", first: "Imran", last: "Khan", role: "DOCTOR", deptCode: "GM", position: "Consultant Physician", doctor: { specialty: "Internal Medicine", qualifications: "MBBS, FCPS (Medicine)", license: "PMDC-DEMO-1001", fee: "2500.00" } }),
    await makeUser({ email: "dr.fatima@demo.hms", first: "Fatima", last: "Siddiqui", role: "DOCTOR", deptCode: "PED", position: "Consultant Pediatrician", doctor: { specialty: "Pediatrics", qualifications: "MBBS, FCPS (Paeds)", license: "PMDC-DEMO-1002", fee: "2000.00", slot: 20 } }),
    await makeUser({ email: "dr.ahmed@demo.hms", first: "Bilal", last: "Ahmed", role: "DOCTOR", deptCode: "CAR", position: "Consultant Cardiologist", doctor: { specialty: "Cardiology", qualifications: "MBBS, FCPS (Cardiology)", license: "PMDC-DEMO-1003", fee: "3500.00", slot: 20 } }),
    await makeUser({ email: "dr.malik@demo.hms", first: "Ayesha", last: "Malik", role: "DOCTOR", deptCode: "ORT", position: "Orthopedic Surgeon", doctor: { specialty: "Orthopedic Surgery", qualifications: "MBBS, MS (Ortho)", license: "PMDC-DEMO-1004", fee: "3000.00" } }),
    await makeUser({ email: "dr.raza@demo.hms", first: "Hassan", last: "Raza", role: "DOCTOR", deptCode: "ER", position: "Emergency Physician", doctor: { specialty: "Emergency Medicine", qualifications: "MBBS, FCPS (EM)", license: "PMDC-DEMO-1005", fee: "2000.00" } }),
  ];
  const nurse = await makeUser({ email: "nurse@demo.hms", first: "Rabia", last: "Butt", role: "NURSE", deptCode: "NUR", position: "Charge Nurse" });
  const labTech = await makeUser({ email: "lab@demo.hms", first: "Kamran", last: "Mirza", role: "LAB_TECHNICIAN", deptCode: "LAB", position: "Senior Lab Technologist" });
  const radTech = await makeUser({ email: "radiology@demo.hms", first: "Omar", last: "Sheikh", role: "RADIOLOGIST", deptCode: "RAD", position: "Radiologist" });
  const pharmacist = await makeUser({ email: "pharmacy@demo.hms", first: "Hira", last: "Qureshi", role: "PHARMACIST", deptCode: "PHR", position: "Pharmacist" });
  const accountant = await makeUser({ email: "billing@demo.hms", first: "Faisal", last: "Iqbal", role: "ACCOUNTANT", deptCode: "FIN", position: "Billing Officer" });
  const hr = await makeUser({ email: "hr@demo.hms", first: "Maryam", last: "Abbasi", role: "HR_MANAGER", deptCode: "ADM", position: "HR Manager" });
  // Staff without logins
  for (let i = 0; i < 6; i++) {
    const sex = rnd() > 0.5;
    await prisma.staff.create({ data: { employeeNo: await newId(prisma, "employee"), firstName: sex ? pick(FIRST_F) : pick(FIRST_M), lastName: pick(LAST), position: pick(["Staff Nurse", "Ward Attendant", "Lab Assistant", "Receptionist", "Housekeeping"]), departmentId: pick([dept.NUR, dept.LAB, dept.ADM, dept.GM]).id, joiningDate: new Date(Date.UTC(2022, int(0, 11), int(1, 28))), shift: pick(["MORNING", "EVENING", "NIGHT"]), phone: `+92 302 ${int(1000000, 9999999)}` } });
  }

  // ── Patients ─────────────────────────────────────────────
  const patients = [];
  const today = todayInTz(TZ);
  for (let i = 0; i < 32; i++) {
    const female = i % 2 === 0;
    const first = female ? FIRST_F[i % FIRST_F.length] : FIRST_M[i % FIRST_M.length];
    const last = LAST[(i * 7) % LAST.length];
    const age = i < 4 ? int(2, 12) : int(18, 78);
    const regDaysAgo = int(0, 120);
    const p = await prisma.patient.create({
      data: {
        mrn: await newId(prisma, "patient"), firstName: first, lastName: last, sex: female ? "FEMALE" : "MALE",
        dateOfBirth: new Date(Date.UTC(2026 - age, int(0, 11), int(1, 28))),
        phone: `+92 3${int(0, 4)}${int(0, 9)} ${int(1000000, 9999999)}`, email: rnd() > 0.5 ? `${first}.${last}${i}@example.com`.toLowerCase() : null,
        address: `House ${int(1, 300)}, Street ${int(1, 40)} (demo)`, city: pick(CITIES), bloodGroup: pick(["A+", "B+", "O+", "AB+", "A-", "O-", null]),
        medicalAlerts: i % 9 === 0 ? "Diabetic — check glucose before procedures" : null,
        consentToSms: rnd() > 0.3, consentToEmail: rnd() > 0.6,
        registeredAt: new Date(Date.now() - regDaysAgo * 86400000), createdById: reception.user.id,
        emergencyContacts: { create: [{ name: `${pick(FIRST_M)} ${last}`, relationship: pick(["Spouse", "Father", "Brother", "Son", "Mother"]), phone: `+92 333 ${int(1000000, 9999999)}` }] },
      },
    });
    if (i % 5 === 0) await prisma.allergy.create({ data: { patientId: p.id, substance: pick(["Penicillin", "Sulfa drugs", "Peanuts", "Aspirin"]), reaction: pick(["Rash", "Anaphylaxis", "Hives"]), severity: pick(["MILD", "MODERATE", "SEVERE"]), recordedById: nurse.user.id } });
    if (i % 4 === 0) await prisma.medicalHistory.create({ data: { patientId: p.id, category: "PAST_ILLNESS", description: pick(["Type 2 diabetes mellitus", "Essential hypertension", "Bronchial asthma", "Hypothyroidism"]), recordedById: doctors[0].user.id } });
    patients.push(p);
  }
  // Patient portal account linked to the first patient
  const portalUser = await makeUser({ email: "patient@demo.hms", first: patients[0].firstName, last: patients[0].lastName, role: "PATIENT" });
  await prisma.patientUserLink.create({ data: { patientId: patients[0].id, userId: portalUser.user.id, verifiedAt: new Date() } });

  // ── Lab catalogue ────────────────────────────────────────
  const labDefs = [
    ["HB", "Haemoglobin", "Haematology", "Whole blood (EDTA)", "g/dL", "12.000", "17.500", "450.00"],
    ["WBC", "White cell count", "Haematology", "Whole blood (EDTA)", "×10⁹/L", "4.000", "11.000", "350.00"],
    ["PLT", "Platelet count", "Haematology", "Whole blood (EDTA)", "×10⁹/L", "150.000", "400.000", "350.00"],
    ["FBS", "Fasting blood glucose", "Biochemistry", "Plasma (fluoride)", "mg/dL", "70.000", "100.000", "300.00"],
    ["HBA1C", "HbA1c", "Biochemistry", "Whole blood (EDTA)", "%", "4.000", "5.600", "1800.00"],
    ["CREA", "Serum creatinine", "Biochemistry", "Serum", "mg/dL", "0.600", "1.200", "500.00"],
    ["ALT", "ALT (SGPT)", "Biochemistry", "Serum", "U/L", "7.000", "56.000", "500.00"],
    ["TSH", "TSH", "Endocrinology", "Serum", "mIU/L", "0.400", "4.000", "1500.00"],
    ["CHOL", "Total cholesterol", "Biochemistry", "Serum", "mg/dL", null, "200.000", "600.00"],
    ["UA", "Urinalysis (routine)", "Clinical pathology", "Urine", null, null, null, "400.00"],
  ];
  const labTests = {};
  for (const [code, name, category, specimenType, unit, lo, hi, price] of labDefs) {
    labTests[code] = await prisma.laboratoryTest.create({ data: { code, name, category, specimenType, unit, referenceLow: lo, referenceHigh: hi, referenceText: code === "UA" ? "See report" : null, price } });
  }

  // ── Suppliers, medications, batches (with ledger) ────────
  const suppliers = [];
  for (const n of ["MediSupply Traders (demo)", "Pharma Distributors Co. (demo)", "Surgical World (demo)"]) suppliers.push(await prisma.supplier.create({ data: { name: n, phone: `+92 42 ${int(1000000, 9999999)}` } }));
  const medDefs = [
    ["PCM500", "Paracetamol", "Panadol", "500 mg", "TABLET", "Analgesic", "4.00", 200],
    ["AMX500", "Amoxicillin", "Amoxil", "500 mg", "CAPSULE", "Antibiotic", "18.00", 100],
    ["AZM250", "Azithromycin", "Zithromax", "250 mg", "TABLET", "Antibiotic", "45.00", 60],
    ["MET500", "Metformin", "Glucophage", "500 mg", "TABLET", "Antidiabetic", "6.00", 150],
    ["AML5", "Amlodipine", "Norvasc", "5 mg", "TABLET", "Antihypertensive", "9.00", 120],
    ["OMP20", "Omeprazole", "Risek", "20 mg", "CAPSULE", "PPI", "12.00", 120],
    ["IBU400", "Ibuprofen", "Brufen", "400 mg", "TABLET", "NSAID", "7.00", 150],
    ["CTZ10", "Cetirizine", "Zyrtec", "10 mg", "TABLET", "Antihistamine", "5.00", 100],
    ["SALINH", "Salbutamol", "Ventolin", "100 mcg/dose", "INHALER", "Bronchodilator", "450.00", 20],
    ["ORS", "Oral rehydration salts", "ORS", "Sachet", "SACHET", "Electrolyte", "25.00", 100],
    ["CEFT1G", "Ceftriaxone", "Rocephin", "1 g", "INJECTION", "Antibiotic", "350.00", 40],
    ["ATR20", "Atorvastatin", "Lipitor", "20 mg", "TABLET", "Statin", "22.00", 100],
    ["LOS50", "Losartan", "Cozaar", "50 mg", "TABLET", "Antihypertensive", "15.00", 100],
    ["PCMSYR", "Paracetamol", "Calpol", "120 mg/5 mL", "SYRUP", "Analgesic", "180.00", 30],
    ["INSR", "Insulin regular", "Humulin R", "100 IU/mL", "INJECTION", "Antidiabetic", "1200.00", 10],
  ];
  const meds = {};
  for (const [code, generic, brand, strength, form, category, price, reorder] of medDefs) {
    const m = await prisma.medication.create({ data: { code, genericName: generic, brandName: brand, strength, dosageForm: form, category, manufacturer: "Demo Pharma", sellingPrice: price, reorderLevel: reorder } });
    meds[code] = m;
    const batchCount = code === "INSR" || code === "AZM250" ? 1 : 2;
    for (let b = 0; b < batchCount; b++) {
      const nearExpiry = (code === "CTZ10" && b === 0) || code === "ORS";
      const low = code === "INSR" || code === "AZM250" || code === "SALINH";
      const qty = low ? int(3, Math.max(4, Math.floor(reorder / 3))) : int(reorder, reorder * 4);
      const expiry = nearExpiry ? addDays(today, int(20, 75)) : addDays(today, int(240, 720));
      const batch = await prisma.medicationBatch.create({ data: { medicationId: m.id, batchNo: `${code}-B${24 + b}${int(10, 99)}`, expiryDate: new Date(expiry), quantity: qty, purchaseCost: (Number(price) * 0.7).toFixed(2), supplierId: pick(suppliers).id } });
      await prisma.stockMovement.create({ data: { type: "RECEIPT", medicationId: m.id, batchId: batch.id, quantity: qty, balanceAfter: qty, reason: "Opening stock (demo)", performedById: pharmacist.user.id } });
    }
  }

  // ── Wards & beds ─────────────────────────────────────────
  const wardDefs = [["GMW", "General Ward — Male", "GENERAL", "GM", 10, "3000.00"], ["GFW", "General Ward — Female", "GENERAL", "GM", 10, "3000.00"], ["ICU", "Intensive Care Unit", "ICU", "GM", 4, "15000.00"], ["PVT", "Private Rooms", "PRIVATE", "GM", 6, "8000.00"], ["PDW", "Pediatric Ward", "PEDIATRIC", "PED", 6, "2500.00"]];
  const beds = {};
  for (const [code, name, type, d, count, rate] of wardDefs) {
    const w = await prisma.ward.create({ data: { facilityId: facility.id, departmentId: dept[d].id, code, name, type, dailyRate: rate } });
    beds[code] = [];
    for (let i = 1; i <= count; i++) beds[code].push(await prisma.bed.create({ data: { wardId: w.id, label: `${code}-${String(i).padStart(2, "0")}`, status: i === count ? "OUT_OF_SERVICE" : i === count - 1 ? "CLEANING" : "AVAILABLE" } }));
  }

  // ── Appointments, encounters, prescriptions, labs, invoices ──
  const settingsTax = "0";
  async function createInvoice(patientId, items, { paid = "0", status, daysAgo = 0, method = "CASH" }) {
    const totals = calcInvoiceTotals(items, { amountPaid: paid });
    const when = new Date(Date.now() - daysAgo * 86400000);
    const inv = await prisma.invoice.create({
      data: {
        invoiceNo: await newId(prisma, "invoice"), patientId, status, subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, total: totals.total,
        amountPaid: paid, balance: totals.balance, issuedAt: when, createdAt: when, createdById: accountant.user.id,
        items: { create: items.map((it) => ({ ...it, discount: it.discount ?? "0", taxRate: it.taxRate ?? settingsTax, lineTotal: calcLine(it).lineTotal })) },
      },
    });
    if (Number(paid) > 0) await prisma.payment.create({ data: { receiptNo: await newId(prisma, "receipt"), invoiceId: inv.id, amount: paid, method, receivedById: accountant.user.id, receivedAt: when } });
    return inv;
  }

  const diagnoses = [["J06.9", "Acute upper respiratory infection"], ["I10", "Essential (primary) hypertension"], ["E11.9", "Type 2 diabetes mellitus without complications"], ["K21.9", "Gastro-oesophageal reflux disease"], ["M54.5", "Low back pain"], ["J45.9", "Asthma, unspecified"], ["A09", "Infectious gastroenteritis"]];
  let apptCount = 0;
  for (let dayOffset = -30; dayOffset <= 7; dayOffset++) {
    const date = addDays(today, dayOffset);
    const wd = weekdayOf(date);
    if (wd === 0) continue;
    const perDay = dayOffset === 0 ? 10 : dayOffset > 0 ? int(2, 5) : int(2, 6);
    for (let k = 0; k < perDay; k++) {
      const doc = doctors[k % 4];
      const dp = doc.doctorProfile;
      const slot = dp.slotMinutes;
      const startMin = 9 * 60 + (Math.floor(k / 4) * 3 + int(0, 2)) * slot;
      if (startMin + slot > 13 * 60) continue;
      const hh = String(Math.floor(startMin / 60)).padStart(2, "0"), mm = String(startMin % 60).padStart(2, "0");
      const startsAt = zonedToUtc(date, `${hh}:${mm}`, TZ);
      const endsAt = new Date(startsAt.getTime() + slot * 60000);
      const clash = await prisma.appointment.findFirst({ where: { doctorId: dp.id, status: { notIn: ["CANCELLED", "NO_SHOW"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
      if (clash) continue;
      const patient = patients[(apptCount * 3 + k) % patients.length];
      let status;
      if (dayOffset < 0) status = pick(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "CANCELLED", "NO_SHOW"]);
      else if (dayOffset === 0) status = ["COMPLETED", "COMPLETED", "IN_PROGRESS", "CHECKED_IN", "CHECKED_IN", "CONFIRMED", "SCHEDULED", "SCHEDULED", "SCHEDULED", "CANCELLED"][k] || "SCHEDULED";
      else status = pick(["SCHEDULED", "CONFIRMED", "SCHEDULED"]);
      const appt = await prisma.appointment.create({
        data: {
          appointmentNo: await newId(prisma, "appointment"), patientId: patient.id, doctorId: dp.id, departmentId: dp.departmentId, startsAt, endsAt,
          type: pick(["NEW", "FOLLOW_UP", "NEW"]), status, reason: pick(["Fever and cough", "BP follow-up", "Diabetes review", "Back pain", "Routine check-up", "Abdominal pain", "Joint pain"]),
          fee: dp.consultationFee, cancelReason: status === "CANCELLED" ? "Patient requested (demo)" : null,
          checkedInAt: ["CHECKED_IN", "IN_PROGRESS", "COMPLETED"].includes(status) ? new Date(startsAt.getTime() - 10 * 60000) : null,
          completedAt: status === "COMPLETED" ? endsAt : null, createdById: reception.user.id, createdAt: new Date(startsAt.getTime() - int(1, 6) * 86400000),
        },
      });
      apptCount++;
      if (["CHECKED_IN", "IN_PROGRESS"].includes(status)) {
        await prisma.queueEntry.create({ data: { appointmentId: appt.id, tokenNumber: k + 1, queueDate: new Date(date), status: status === "IN_PROGRESS" ? "IN_CONSULTATION" : "WAITING" } });
      }
      if (status === "COMPLETED" || status === "IN_PROGRESS") {
        const dx = pick(diagnoses);
        const finalized = status === "COMPLETED";
        const enc = await prisma.encounter.create({
          data: {
            encounterNo: await newId(prisma, "encounter"), patientId: patient.id, doctorId: dp.id, departmentId: dp.departmentId, appointmentId: appt.id, type: "OPD",
            status: finalized ? "FINALIZED" : "DRAFT", chiefComplaint: appt.reason, historyOfPresentIllness: "Symptoms for 3–5 days. (Synthetic demonstration note.)",
            examination: "Alert, oriented. Vitals stable. (Synthetic.)", assessment: finalized ? dx[1] : null, plan: finalized ? "Medication as prescribed; review in 2 weeks. (Synthetic.)" : null,
            startedAt: startsAt, finalizedAt: finalized ? endsAt : null, finalizedById: finalized ? doc.user.id : null,
            diagnoses: finalized ? { create: [{ code: dx[0], description: dx[1], isPrimary: true }] } : undefined,
          },
        });
        await prisma.vitalSign.create({ data: { patientId: patient.id, encounterId: enc.id, temperatureC: (36.5 + rnd() * 1.8).toFixed(1), pulse: int(64, 104), respRate: int(14, 22), systolic: int(108, 158), diastolic: int(68, 98), spo2: int(94, 99), weightKg: int(48, 92), recordedById: nurse.user.id, recordedAt: startsAt } });
        if (finalized) {
          const items = [{ category: "CONSULTATION", description: `Consultation — Dr. ${doc.staff.firstName} ${doc.staff.lastName}`, quantity: 1, unitPrice: dp.consultationFee.toString(), sourceType: "Encounter", sourceId: enc.id, encounterId: enc.id }];
          // prescription
          const m1 = pick(Object.values(meds)), m2 = pick(Object.values(meds));
          const rxDispensed = dayOffset < -2;
          await prisma.prescription.create({
            data: {
              prescriptionNo: await newId(prisma, "prescription"), patientId: patient.id, doctorId: dp.id, encounterId: enc.id, status: rxDispensed ? "DISPENSED" : "ACTIVE", issuedAt: endsAt, createdAt: endsAt,
              items: { create: [
                { medicationId: m1.id, dose: "1 tablet", route: "Oral", frequency: "Twice daily", durationDays: 5, quantity: 10, dispensedQty: rxDispensed ? 10 : 0, instructions: "After meals" },
                ...(m2.id !== m1.id ? [{ medicationId: m2.id, dose: "1 tablet", route: "Oral", frequency: "Once daily", durationDays: 7, quantity: 7, dispensedQty: rxDispensed ? 7 : 0 }] : []),
              ] },
            },
          });
          // lab order for ~half the encounters
          if (rnd() > 0.45) {
            const tests = [labTests.HB, labTests.WBC, labTests.FBS].slice(0, int(1, 3));
            const released = dayOffset < -1;
            const ord = await prisma.labOrder.create({
              data: {
                orderNo: await newId(prisma, "labOrder"), patientId: patient.id, doctorId: dp.id, encounterId: enc.id, priority: pick(["ROUTINE", "ROUTINE", "URGENT"]),
                status: released ? "RELEASED" : dayOffset === -1 ? "AWAITING_VALIDATION" : "REQUESTED", releasedAt: released ? new Date(endsAt.getTime() + 6 * 3600000) : null,
                releasedById: released ? labTech.user.id : null, createdAt: endsAt,
                items: { create: tests.map((t) => ({ testId: t.id, price: t.price })) },
              },
              include: { items: { include: { test: true } } },
            });
            if (released || dayOffset === -1) {
              await prisma.specimen.create({ data: { orderId: ord.id, specimenNo: await newId(prisma, "specimen"), type: ord.items[0].test.specimenType, collectedById: labTech.user.id, collectedAt: new Date(endsAt.getTime() + 1800000) } });
              for (const it of ord.items) {
                const lo = Number(it.test.referenceLow ?? 0), hi = Number(it.test.referenceHigh ?? 100);
                const v = (lo + (hi - lo) * (rnd() * 1.4 - 0.1)).toFixed(1);
                const flag = Number(v) < lo ? "LOW" : Number(v) > hi ? "HIGH" : "NORMAL";
                await prisma.labResult.create({ data: { orderItemId: it.id, value: v, numericValue: v, unit: it.test.unit, referenceRange: `${lo}–${hi}`, flag, enteredById: labTech.user.id, enteredAt: new Date(endsAt.getTime() + 4 * 3600000), validatedById: released ? labTech.user.id : null, validatedAt: released ? new Date(endsAt.getTime() + 6 * 3600000) : null } });
              }
            }
            for (const it of ord.items) items.push({ category: "LAB", description: it.test.name, quantity: 1, unitPrice: it.price.toString(), sourceType: "LabOrderItem", sourceId: it.id, encounterId: enc.id });
          }
          const total = calcInvoiceTotals(items).total;
          const mode = pick(["PAID", "PAID", "PAID", "PARTIAL", "ISSUED"]);
          const paid = mode === "PAID" ? total : mode === "PARTIAL" ? (Number(total) / 2).toFixed(2) : "0";
          await createInvoice(patient.id, items, { paid, status: mode === "PAID" ? "PAID" : mode === "PARTIAL" ? "PARTIALLY_PAID" : "ISSUED", daysAgo: -dayOffset, method: pick(["CASH", "CARD", "BANK_TRANSFER"]) });
        }
      }
    }
  }

  // ── Admissions with bed assignments ──────────────────────
  const admitPlan = [["GMW", 1, patients[3], doctors[0], 3], ["GMW", 2, patients[5], doctors[0], 1], ["GFW", 1, patients[4], doctors[0], 2], ["ICU", 1, patients[7], doctors[2], 4], ["PDW", 1, patients[1], doctors[1], 1], ["PVT", 1, patients[9], doctors[3], 2]];
  for (const [ward, bedIdx, p, d, daysAgo] of admitPlan) {
    const bed = beds[ward][bedIdx - 1];
    const adm = await prisma.admission.create({ data: { admissionNo: await newId(prisma, "admission"), patientId: p.id, doctorId: d.doctorProfile.id, reason: pick(["Community-acquired pneumonia", "Uncontrolled diabetes", "Chest pain for evaluation", "Post-operative care", "Severe dehydration"]), admittedAt: new Date(Date.now() - daysAgo * 86400000), expectedDischargeAt: new Date(Date.now() + int(1, 4) * 86400000), createdById: reception.user.id } });
    await prisma.bedAssignment.create({ data: { admissionId: adm.id, bedId: bed.id, startedAt: adm.admittedAt, assignedById: reception.user.id } });
    await prisma.bed.update({ where: { id: bed.id }, data: { status: "OCCUPIED", currentAdmissionId: adm.id } });
    await prisma.clinicalNote.create({ data: { admissionId: adm.id, kind: "NURSING", content: "Patient settled in ward. Observations stable. (Synthetic demonstration note.)", authorId: nurse.user.id } });
    await prisma.vitalSign.create({ data: { patientId: p.id, admissionId: adm.id, temperatureC: "37.4", pulse: 88, respRate: 18, systolic: 128, diastolic: 82, spo2: 96, recordedById: nurse.user.id } });
  }
  // a past, discharged admission
  {
    const p = patients[11], bed = beds.GMW[3];
    const adm = await prisma.admission.create({ data: { admissionNo: await newId(prisma, "admission"), patientId: p.id, doctorId: doctors[0].doctorProfile.id, reason: "Acute gastroenteritis with dehydration", status: "DISCHARGED", admittedAt: new Date(Date.now() - 12 * 86400000), dischargedAt: new Date(Date.now() - 9 * 86400000), dischargeCondition: "Improved", dischargeSummary: "Rehydrated with IV fluids; tolerating oral intake. (Synthetic demonstration summary.)" } });
    await prisma.bedAssignment.create({ data: { admissionId: adm.id, bedId: bed.id, startedAt: adm.admittedAt, endedAt: adm.dischargedAt } });
  }

  // ── Emergency, ambulances ────────────────────────────────
  const amb1 = await prisma.ambulance.create({ data: { vehicleNo: "LEA-0001 (demo)", type: "ALS", status: "AVAILABLE", driverName: "Zubair Rana", driverPhone: "+92 300 0000001" } });
  await prisma.ambulance.create({ data: { vehicleNo: "LEA-0002 (demo)", type: "BLS", status: "MAINTENANCE", driverName: "Saad Javed", driverPhone: "+92 300 0000002" } });
  const er = [["AMBULANCE", "Chest pain radiating to left arm", "ORANGE", "UNDER_TREATMENT"], ["WALK_IN", "Laceration to right hand", "GREEN", "TRIAGED"], ["WALK_IN", "High-grade fever, child", null, "WAITING_TRIAGE"]];
  for (const [mode, complaint, cat, status] of er) {
    const v = await prisma.emergencyVisit.create({ data: { visitNo: await newId(prisma, "emergency"), patientId: pick(patients).id, arrivalMode: mode, presentingComplaint: complaint, triageCategory: cat, triagedById: cat ? nurse.user.id : null, assignedClinicianId: status === "UNDER_TREATMENT" ? doctors[4].user.id : null, status, arrivedAt: new Date(Date.now() - int(10, 180) * 60000) } });
    if (mode === "AMBULANCE") await prisma.ambulanceDispatch.create({ data: { ambulanceId: amb1.id, emergencyVisitId: v.id, pickupAddress: "Model Town, Lahore (demo)", destination: "Demo General Hospital — ER", dispatchedAt: new Date(Date.now() - 120 * 60000), arrivedAt: new Date(Date.now() - 95 * 60000), completedAt: new Date(Date.now() - 80 * 60000), status: "COMPLETED" } });
  }

  // ── Radiology ────────────────────────────────────────────
  for (const [i, st] of ["REQUESTED", "SCHEDULED", "VERIFIED"].entries()) {
    const s = await prisma.imagingStudy.create({ data: { studyNo: await newId(prisma, "imaging"), patientId: patients[i + 2].id, requestedById: doctors[i % 4].user.id, modality: ["XRAY", "US", "XRAY"][i], bodyPart: ["Chest PA", "Abdomen & pelvis", "Knee AP/Lat"][i], indication: "Clinical evaluation (demo)", price: ["1500.00", "3000.00", "1800.00"][i], status: st, scheduledAt: st !== "REQUESTED" ? new Date(Date.now() + 3600000) : null } });
    if (st === "VERIFIED") await prisma.imagingReport.create({ data: { studyId: s.id, findings: "No acute bony abnormality. Joint spaces preserved. (Synthetic demonstration report.)", impression: "Normal study (synthetic).", reportedById: radTech.user.id, verifiedById: radTech.user.id, verifiedAt: new Date() } });
  }

  // ── Theatre & procedures ─────────────────────────────────
  const ot1 = await prisma.operatingTheatre.create({ data: { name: "OT-1" } });
  await prisma.operatingTheatre.create({ data: { name: "OT-2" } });
  await prisma.procedure.create({ data: { procedureNo: await newId(prisma, "procedure"), patientId: patients[9].id, theatreId: ot1.id, surgeonId: doctors[3].doctorProfile.id, name: "Arthroscopic knee debridement", scheduledStart: zonedToUtc(addDays(today, 1), "10:00", TZ), scheduledEnd: zonedToUtc(addDays(today, 1), "11:30", TZ), charge: "85000.00" } });

  // ── Insurance ────────────────────────────────────────────
  const ins = await prisma.insuranceProvider.create({ data: { name: "Demo Health Insurance Ltd.", phone: "+92 21 0000 0000" } });
  await prisma.insuranceProvider.create({ data: { name: "Sample Takaful Co.", phone: "+92 42 0000 0001" } });
  for (const p of patients.slice(0, 5)) await prisma.insurancePolicy.create({ data: { patientId: p.id, providerId: ins.id, policyNumber: `DHI-${int(100000, 999999)}`, coverageStart: new Date(`${addDays(today, -200)}`), coverageEnd: new Date(`${addDays(today, 165)}`), coverageNotes: "OPD + IPD up to PKR 500,000 / year (demo)" } });

  // ── General inventory ────────────────────────────────────
  const invDefs = [["GLV-M", "Examination gloves (M), box of 100", "CONSUMABLE", "box", 40, 20, "950.00"], ["SYR-5", "Syringe 5 mL", "CONSUMABLE", "piece", 600, 300, "18.00"], ["GZE-10", "Sterile gauze 10×10", "CONSUMABLE", "pack", 80, 100, "120.00"], ["IVC-20", "IV cannula 20G", "CONSUMABLE", "piece", 150, 100, "65.00"], ["BPM-01", "BP monitor (digital)", "EQUIPMENT", "unit", 6, 2, "8500.00"], ["MSK-N95", "N95 respirator", "CONSUMABLE", "piece", 30, 50, "220.00"]];
  for (const [code, name, category, unit, qty, reorder, cost] of invDefs) {
    const it = await prisma.inventoryItem.create({ data: { code, name, category, unit, quantity: qty, reorderLevel: reorder, unitCost: cost, location: "Central store" } });
    await prisma.stockMovement.create({ data: { type: "RECEIPT", inventoryItemId: it.id, quantity: qty, balanceAfter: qty, reason: "Opening stock (demo)", performedById: hadmin.user.id } });
  }

  // ── HR: attendance & leave ───────────────────────────────
  const allStaff = await prisma.staff.findMany();
  for (let d = -6; d <= 0; d++) {
    const date = addDays(today, d);
    if (weekdayOf(date) === 0) continue;
    for (const s of allStaff) await prisma.employeeAttendance.create({ data: { staffId: s.id, date: new Date(date), status: pick(["PRESENT", "PRESENT", "PRESENT", "PRESENT", "LATE", "ABSENT"]) } });
  }
  await prisma.leaveRequest.create({ data: { staffId: nurse.staff.id, type: "ANNUAL", startDate: new Date(addDays(today, 10)), endDate: new Date(addDays(today, 14)), reason: "Family event (demo)" } });

  // ── Notifications ────────────────────────────────────────
  const n = (userId, category, title, body, link) => ({ userId, category, title, body, link });
  await prisma.notification.createMany({ data: [
    n(admin.user.id, "SYSTEM", "Demo data loaded", "This environment contains synthetic demonstration data only.", "/dashboard"),
    n(hadmin.user.id, "PHARMACY", "Low stock alert", "3 medicines are at or below reorder level.", "/pharmacy?tab=stock&status=low"),
    n(pharmacist.user.id, "PHARMACY", "Low stock alert", "3 medicines are at or below reorder level.", "/pharmacy?tab=stock&status=low"),
    n(pharmacist.user.id, "PHARMACY", "Batches nearing expiry", "Some batches expire within 90 days.", "/pharmacy?tab=stock&status=expiring"),
    n(labTech.user.id, "LAB", "Results awaiting validation", "New results are waiting for validation.", "/laboratory?status=AWAITING_VALIDATION"),
    n(hr.user.id, "HR", "Leave request pending", "A staff leave request needs a decision.", "/staff?tab=leave"),
    n(doctors[0].user.id, "APPOINTMENT", "Today's clinic", "You have patients waiting in today's queue.", "/consultations"),
    n(portalUser.user.id, "APPOINTMENT", "Welcome to the patient portal", "View your appointments, prescriptions and results here.", "/portal"),
  ] });

  await prisma.auditLog.create({ data: { userId: admin.user.id, action: "system.seed", entityType: "System", metadata: { note: "Demonstration data seeded" } } });

  console.log("\n✔ Demo data ready (DEMONSTRATION DATA — synthetic, not real patients).");
  console.log("  Accounts: admin@demo.hms, hadmin@demo.hms, reception@demo.hms, dr.khan@demo.hms, dr.fatima@demo.hms,");
  console.log("            nurse@demo.hms, lab@demo.hms, radiology@demo.hms, pharmacy@demo.hms, billing@demo.hms, hr@demo.hms, patient@demo.hms");
  if (process.env.SEED_DEMO_PASSWORD) console.log("  Password: value of SEED_DEMO_PASSWORD");
  else console.log(`  Generated password for all demo accounts (shown once): ${demoPassword}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
