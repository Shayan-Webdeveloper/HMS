import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { D, toMoneyString, formatMoney } from "@/lib/utils/money";
import { addDays, dayRangeUtc, todayInTz, formatDateTime, formatDateOnly, toZonedDateString, toZonedTimeString } from "@/lib/utils/time";
import { MAX_EXPORT_ROWS } from "@/lib/utils/csv";
import { dayList, daysBetween, fillDaily, formatDayLabel, isDateString, MAX_RANGE_DAYS, LAB_PENDING } from "@/lib/services/dashboard";

// Every report is a config object; the report page, the JSON API and the CSV export all run
// the same `run()` so on-screen numbers and exported numbers can never disagree.
//
//   { key, title, category, description, definition, requires:[perm…] (all required),
//     filters:["dateRange","department","doctor","status"], statusLabel?, statusOptions?, defaultStatus?,
//     columns:[{ key, label, format }], run(filters, ctx) → { rows, summary:[{label,value,format}], chart? } }
//
// Column formats: text | int | decimal | money | percent | hours | date (YYYY-MM-DD) | dateOnly (@db.Date) | datetime

export const REPORT_CATEGORIES = ["Patients & clinics", "Inpatient & emergency", "Diagnostics", "Pharmacy & inventory", "Finance", "Staff"];

const READ = ["reports:read"];
const FIN = ["reports:read", "reports:financial"];
const sqlAnd = (conds) => Prisma.join(conds, " AND ");
const sumBy = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const sumMoney = (rows, k) => toMoneyString(rows.reduce((s, r) => s.plus(D(r[k])), D(0)));
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const num1 = (v) => (v == null ? null : Number(D(v).toFixed(1)));
const fullName = (s) => (s ? `${s.firstName} ${s.lastName}` : "—");
const opts = (list) => list.map((v) => ({ value: v, label: v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));

const APPOINTMENT_STATUSES = ["REQUESTED", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"];
const ENCOUNTER_STATUSES = ["DRAFT", "FINALIZED", "CANCELLED"];
const LAB_STATUSES = ["REQUESTED", "SAMPLE_COLLECTED", "PROCESSING", "AWAITING_VALIDATION", "RELEASED", "CANCELLED", "REJECTED"];
const ER_STATUSES = ["WAITING_TRIAGE", "TRIAGED", "UNDER_TREATMENT", "ADMITTED", "TRANSFERRED", "DISCHARGED", "LEFT_WITHOUT_BEING_SEEN"];
const CLAIM_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_APPROVED", "REJECTED", "PAID"];
const METHODS = ["CASH", "CARD", "BANK_TRANSFER", "ONLINE"];

// ───────────────────────────── Report definitions ─────────────────────────────

export const REPORTS = [
  {
    key: "patient-registrations", title: "Patient registrations", category: "Patients & clinics", requires: READ,
    description: "New patient records per day, by sex.",
    definition: "Counts patient records by registration date (hospital time zone). Merged duplicate records are excluded.",
    filters: ["dateRange"],
    columns: [{ key: "date", label: "Date", format: "date" }, { key: "total", label: "Registrations", format: "int" }, { key: "male", label: "Male", format: "int" }, { key: "female", label: "Female", format: "int" }, { key: "other", label: "Other / not recorded", format: "int" }],
    async run(f, ctx) {
      const rows = await prisma.$queryRaw`SELECT to_char(("registeredAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, sex::text AS sex, count(*)::int AS n FROM "Patient" WHERE status <> 'MERGED' AND "registeredAt" >= ${f.start} AND "registeredAt" < ${f.end} GROUP BY 1, 2`;
      const byDay = new Map();
      for (const r of rows) {
        const o = byDay.get(r.day) || { total: 0, male: 0, female: 0, other: 0 };
        o.total += r.n;
        if (r.sex === "MALE") o.male += r.n; else if (r.sex === "FEMALE") o.female += r.n; else o.other += r.n;
        byDay.set(r.day, o);
      }
      const data = fillDaily(f.days, byDay, ["total", "male", "female", "other"]);
      const total = sumBy(data, "total");
      return {
        rows: data,
        summary: [{ label: "New registrations", value: total, format: "int" }, { label: "Average per day", value: (total / data.length).toFixed(1), format: "decimal" }, { label: "Male", value: sumBy(data, "male"), format: "int" }, { label: "Female", value: sumBy(data, "female"), format: "int" }],
        chart: { kind: "bar", data, series: [{ key: "total", label: "Registrations", color: "primary" }], yLabel: "Patients" },
      };
    },
  },
  {
    key: "appointments", title: "Appointments", category: "Patients & clinics", requires: READ,
    description: "Daily appointment volume with completion, cancellations and no-shows.",
    definition: "Appointments by scheduled start date (hospital time zone). Open = requested, scheduled, confirmed, checked-in or in progress. Attendance rate = completed ÷ (completed + no-show).",
    filters: ["dateRange", "department", "doctor", "status"], statusOptions: opts(APPOINTMENT_STATUSES),
    columns: [{ key: "date", label: "Date", format: "date" }, { key: "total", label: "Total", format: "int" }, { key: "completed", label: "Completed", format: "int" }, { key: "open", label: "Open", format: "int" }, { key: "cancelled", label: "Cancelled", format: "int" }, { key: "noShow", label: "No-show", format: "int" }, { key: "walkIns", label: "Walk-ins", format: "int" }],
    async run(f, ctx) {
      const conds = [Prisma.sql`"startsAt" >= ${f.start}`, Prisma.sql`"startsAt" < ${f.end}`];
      if (f.departmentId) conds.push(Prisma.sql`"departmentId" = ${f.departmentId}`);
      if (f.doctorId) conds.push(Prisma.sql`"doctorId" = ${f.doctorId}`);
      if (f.status) conds.push(Prisma.sql`status::text = ${f.status}`);
      const rows = await prisma.$queryRaw`SELECT to_char(("startsAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, status::text AS status, count(*)::int AS n, count(*) FILTER (WHERE type = 'WALK_IN')::int AS walk FROM "Appointment" WHERE ${sqlAnd(conds)} GROUP BY 1, 2`;
      const byDay = new Map();
      for (const r of rows) {
        const o = byDay.get(r.day) || { total: 0, completed: 0, open: 0, cancelled: 0, noShow: 0, walkIns: 0 };
        o.total += r.n; o.walkIns += r.walk;
        if (r.status === "COMPLETED") o.completed += r.n; else if (r.status === "CANCELLED") o.cancelled += r.n; else if (r.status === "NO_SHOW") o.noShow += r.n; else o.open += r.n;
        byDay.set(r.day, o);
      }
      const data = fillDaily(f.days, byDay, ["total", "completed", "open", "cancelled", "noShow", "walkIns"]);
      const completed = sumBy(data, "completed"), noShow = sumBy(data, "noShow");
      return {
        rows: data,
        summary: [{ label: "Appointments", value: sumBy(data, "total"), format: "int" }, { label: "Completed", value: completed, format: "int" }, { label: "Cancelled", value: sumBy(data, "cancelled"), format: "int" }, { label: "No-shows", value: noShow, format: "int" }, { label: "Attendance rate", value: pct(completed, completed + noShow), format: "percent" }],
        chart: { kind: "bar", stacked: true, data, series: [{ key: "completed", label: "Completed", color: "primary" }, { key: "open", label: "Open", color: "teal" }, { key: "cancelled", label: "Cancelled", color: "slate" }, { key: "noShow", label: "No-show", color: "red" }], yLabel: "Appointments" },
      };
    },
  },
  {
    key: "doctor-workload", title: "Doctor workload", category: "Patients & clinics", requires: READ,
    description: "Appointments, consultations, admissions and orders per doctor.",
    definition: "Appointments by scheduled date (cancelled excluded from the total); consultations = encounters finalized in the period; admissions by admission date; lab orders by order date; prescriptions by issue date. Hospital time zone.",
    filters: ["dateRange", "department"],
    columns: [{ key: "doctor", label: "Doctor" }, { key: "department", label: "Department" }, { key: "appointments", label: "Appointments", format: "int" }, { key: "completed", label: "Completed", format: "int" }, { key: "noShow", label: "No-shows", format: "int" }, { key: "consultations", label: "Consultations", format: "int" }, { key: "admissions", label: "Admissions", format: "int" }, { key: "labOrders", label: "Lab orders", format: "int" }, { key: "prescriptions", label: "Prescriptions", format: "int" }],
    async run(f) {
      const inP = { gte: f.start, lt: f.end };
      const dept = f.departmentId ? { departmentId: f.departmentId } : {};
      const [doctors, appts, encs, adms, labs, rxs] = await Promise.all([
        prisma.doctorProfile.findMany({ where: dept, select: { id: true, staff: { select: { firstName: true, lastName: true } }, department: { select: { name: true } } } }),
        prisma.appointment.groupBy({ by: ["doctorId", "status"], where: { startsAt: inP, ...dept }, _count: { _all: true } }),
        prisma.encounter.groupBy({ by: ["doctorId"], where: { status: "FINALIZED", finalizedAt: inP }, _count: { _all: true } }),
        prisma.admission.groupBy({ by: ["doctorId"], where: { admittedAt: inP, status: { not: "CANCELLED" } }, _count: { _all: true } }),
        prisma.labOrder.groupBy({ by: ["doctorId"], where: { createdAt: inP }, _count: { _all: true } }),
        prisma.prescription.groupBy({ by: ["doctorId"], where: { issuedAt: inP, status: { not: "DRAFT" } }, _count: { _all: true } }),
      ]);
      const count = (list) => new Map(list.map((g) => [g.doctorId, g._count._all]));
      const [e, a, l, r] = [count(encs), count(adms), count(labs), count(rxs)];
      const rows = doctors.map((d) => {
        const mine = appts.filter((g) => g.doctorId === d.id);
        const st = (s) => mine.filter((g) => g.status === s).reduce((n, g) => n + g._count._all, 0);
        return {
          doctor: `Dr. ${fullName(d.staff)}`, department: d.department.name,
          appointments: mine.filter((g) => g.status !== "CANCELLED").reduce((n, g) => n + g._count._all, 0), completed: st("COMPLETED"), noShow: st("NO_SHOW"),
          consultations: e.get(d.id) || 0, admissions: a.get(d.id) || 0, labOrders: l.get(d.id) || 0, prescriptions: r.get(d.id) || 0,
        };
      }).sort((x, y) => y.consultations - x.consultations || y.appointments - x.appointments || x.doctor.localeCompare(y.doctor));
      return {
        rows,
        summary: [{ label: "Doctors", value: rows.length, format: "int" }, { label: "Appointments", value: sumBy(rows, "appointments"), format: "int" }, { label: "Consultations", value: sumBy(rows, "consultations"), format: "int" }, { label: "Admissions", value: sumBy(rows, "admissions"), format: "int" }],
        chart: { kind: "category", data: rows.slice(0, 12).map((x) => ({ label: x.doctor, appointments: x.appointments, consultations: x.consultations })), series: [{ key: "appointments", label: "Appointments", color: "slate" }, { key: "consultations", label: "Consultations", color: "primary" }], yLabel: "Count" },
      };
    },
  },
  {
    key: "department-activity", title: "Department activity", category: "Patients & clinics", requires: READ,
    description: "Appointments, encounters, admissions and lab orders by department.",
    definition: "Appointments by scheduled date (cancelled excluded) and department; encounters by start date; admissions and lab orders are attributed to the ordering/attending doctor's department. Hospital time zone.",
    filters: ["dateRange"],
    columns: [{ key: "department", label: "Department" }, { key: "appointments", label: "Appointments", format: "int" }, { key: "completed", label: "Completed", format: "int" }, { key: "encounters", label: "Encounters", format: "int" }, { key: "admissions", label: "Admissions", format: "int" }, { key: "labOrders", label: "Lab orders", format: "int" }],
    async run(f) {
      const inP = { gte: f.start, lt: f.end };
      const [depts, appts, encs, adms, labs] = await Promise.all([
        prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true, isClinical: true } }),
        prisma.appointment.groupBy({ by: ["departmentId", "status"], where: { startsAt: inP, status: { not: "CANCELLED" } }, _count: { _all: true } }),
        prisma.encounter.groupBy({ by: ["departmentId"], where: { startedAt: inP, status: { not: "CANCELLED" } }, _count: { _all: true } }),
        prisma.$queryRaw`SELECT d."departmentId" AS id, count(*)::int AS n FROM "Admission" a JOIN "DoctorProfile" d ON d.id = a."doctorId" WHERE a.status <> 'CANCELLED' AND a."admittedAt" >= ${f.start} AND a."admittedAt" < ${f.end} GROUP BY 1`,
        prisma.$queryRaw`SELECT d."departmentId" AS id, count(*)::int AS n FROM "LabOrder" l JOIN "DoctorProfile" d ON d.id = l."doctorId" WHERE l."createdAt" >= ${f.start} AND l."createdAt" < ${f.end} GROUP BY 1`,
      ]);
      const enc = new Map(encs.map((g) => [g.departmentId, g._count._all]));
      const adm = new Map(adms.map((r) => [r.id, r.n]));
      const lab = new Map(labs.map((r) => [r.id, r.n]));
      const rows = depts.map((d) => {
        const mine = appts.filter((g) => g.departmentId === d.id);
        return {
          department: d.name, appointments: mine.reduce((n, g) => n + g._count._all, 0), completed: mine.filter((g) => g.status === "COMPLETED").reduce((n, g) => n + g._count._all, 0),
          encounters: enc.get(d.id) || 0, admissions: adm.get(d.id) || 0, labOrders: lab.get(d.id) || 0, _keep: d.isActive && d.isClinical,
        };
      }).filter((r) => r._keep || r.appointments || r.encounters || r.admissions || r.labOrders).map(({ _keep, ...r }) => r)
        .sort((x, y) => y.appointments - x.appointments || x.department.localeCompare(y.department));
      return {
        rows,
        summary: [{ label: "Appointments", value: sumBy(rows, "appointments"), format: "int" }, { label: "Encounters", value: sumBy(rows, "encounters"), format: "int" }, { label: "Admissions", value: sumBy(rows, "admissions"), format: "int" }, { label: "Lab orders", value: sumBy(rows, "labOrders"), format: "int" }],
        chart: { kind: "category", data: rows.filter((r) => r.appointments || r.encounters).map((r) => ({ label: r.department, appointments: r.appointments, encounters: r.encounters })), series: [{ key: "appointments", label: "Appointments", color: "primary" }, { key: "encounters", label: "Encounters", color: "teal" }], yLabel: "Count" },
      };
    },
  },
  {
    key: "opd", title: "OPD encounters", category: "Patients & clinics", requires: READ,
    description: "Outpatient consultations per day by documentation status.",
    definition: "OPD-type encounters by start date (hospital time zone). Draft = not yet signed; follow-ups = encounters with a follow-up date set.",
    filters: ["dateRange", "department", "doctor", "status"], statusOptions: opts(ENCOUNTER_STATUSES),
    columns: [{ key: "date", label: "Date", format: "date" }, { key: "total", label: "Encounters", format: "int" }, { key: "finalized", label: "Finalized", format: "int" }, { key: "draft", label: "Draft", format: "int" }, { key: "cancelled", label: "Cancelled", format: "int" }, { key: "followUps", label: "Follow-up set", format: "int" }],
    async run(f, ctx) {
      const conds = [Prisma.sql`type = 'OPD'`, Prisma.sql`"startedAt" >= ${f.start}`, Prisma.sql`"startedAt" < ${f.end}`];
      if (f.departmentId) conds.push(Prisma.sql`"departmentId" = ${f.departmentId}`);
      if (f.doctorId) conds.push(Prisma.sql`"doctorId" = ${f.doctorId}`);
      if (f.status) conds.push(Prisma.sql`status::text = ${f.status}`);
      const [rows, uniq] = await Promise.all([
        prisma.$queryRaw`SELECT to_char(("startedAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, status::text AS status, count(*)::int AS n, count("followUpDate")::int AS fu FROM "Encounter" WHERE ${sqlAnd(conds)} GROUP BY 1, 2`,
        prisma.$queryRaw`SELECT count(DISTINCT "patientId")::int AS n FROM "Encounter" WHERE ${sqlAnd(conds)}`,
      ]);
      const byDay = new Map();
      for (const r of rows) {
        const o = byDay.get(r.day) || { total: 0, finalized: 0, draft: 0, cancelled: 0, followUps: 0 };
        o.total += r.n; o.followUps += r.fu;
        if (r.status === "FINALIZED") o.finalized += r.n; else if (r.status === "DRAFT") o.draft += r.n; else o.cancelled += r.n;
        byDay.set(r.day, o);
      }
      const data = fillDaily(f.days, byDay, ["total", "finalized", "draft", "cancelled", "followUps"]);
      return {
        rows: data,
        summary: [{ label: "Encounters", value: sumBy(data, "total"), format: "int" }, { label: "Finalized", value: sumBy(data, "finalized"), format: "int" }, { label: "Still in draft", value: sumBy(data, "draft"), format: "int" }, { label: "Unique patients", value: uniq[0]?.n ?? 0, format: "int" }],
        chart: { kind: "bar", stacked: true, data, series: [{ key: "finalized", label: "Finalized", color: "primary" }, { key: "draft", label: "Draft", color: "amber" }], yLabel: "Encounters" },
      };
    },
  },
  {
    key: "admissions-discharges", title: "Admissions & discharges", category: "Inpatient & emergency", requires: READ,
    description: "Daily admissions and discharges with average length of stay.",
    definition: "Admissions by admission date (cancelled excluded); discharges by discharge date. Average length of stay = mean (discharge − admission) for patients discharged in the period, in days. Department = attending doctor's department. Hospital time zone.",
    filters: ["dateRange", "department", "doctor"],
    columns: [{ key: "date", label: "Date", format: "date" }, { key: "admissions", label: "Admissions", format: "int" }, { key: "discharges", label: "Discharges", format: "int" }, { key: "net", label: "Net change", format: "int" }],
    async run(f, ctx) {
      const extra = [];
      if (f.departmentId) extra.push(Prisma.sql`d."departmentId" = ${f.departmentId}`);
      if (f.doctorId) extra.push(Prisma.sql`a."doctorId" = ${f.doctorId}`);
      const admConds = [Prisma.sql`a.status <> 'CANCELLED'`, Prisma.sql`a."admittedAt" >= ${f.start}`, Prisma.sql`a."admittedAt" < ${f.end}`, ...extra];
      const disConds = [Prisma.sql`a.status = 'DISCHARGED'`, Prisma.sql`a."dischargedAt" >= ${f.start}`, Prisma.sql`a."dischargedAt" < ${f.end}`, ...extra];
      const [adm, dis, los, current] = await Promise.all([
        prisma.$queryRaw`SELECT to_char((a."admittedAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "Admission" a JOIN "DoctorProfile" d ON d.id = a."doctorId" WHERE ${sqlAnd(admConds)} GROUP BY 1`,
        prisma.$queryRaw`SELECT to_char((a."dischargedAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "Admission" a JOIN "DoctorProfile" d ON d.id = a."doctorId" WHERE ${sqlAnd(disConds)} GROUP BY 1`,
        prisma.$queryRaw`SELECT AVG(EXTRACT(EPOCH FROM (a."dischargedAt" - a."admittedAt")) / 86400.0) AS days FROM "Admission" a JOIN "DoctorProfile" d ON d.id = a."doctorId" WHERE ${sqlAnd(disConds)}`,
        prisma.admission.count({ where: { status: "ADMITTED", ...(f.doctorId ? { doctorId: f.doctorId } : {}), ...(f.departmentId ? { doctor: { departmentId: f.departmentId } } : {}) } }),
      ]);
      const byDay = new Map();
      for (const r of adm) byDay.set(r.day, { ...(byDay.get(r.day) || {}), admissions: r.n });
      for (const r of dis) byDay.set(r.day, { ...(byDay.get(r.day) || {}), discharges: r.n });
      const data = fillDaily(f.days, byDay, ["admissions", "discharges"]).map((r) => ({ ...r, net: r.admissions - r.discharges }));
      return {
        rows: data,
        summary: [{ label: "Admissions", value: sumBy(data, "admissions"), format: "int" }, { label: "Discharges", value: sumBy(data, "discharges"), format: "int" }, { label: "Avg length of stay (days)", value: num1(los[0]?.days), format: "decimal" }, { label: "Currently admitted", value: current, format: "int" }],
        chart: { kind: "line", data, series: [{ key: "admissions", label: "Admissions", color: "primary" }, { key: "discharges", label: "Discharges", color: "amber" }], yLabel: "Patients" },
      };
    },
  },
  {
    key: "bed-occupancy", title: "Bed occupancy", category: "Inpatient & emergency", requires: READ,
    description: "Current bed status per ward plus occupied bed-days over the period.",
    definition: "Snapshot columns show bed status right now (active wards). Occupied bed-days = time beds were assigned to admissions within the period (up to now). Average occupancy = occupied bed-days ÷ (in-service beds × elapsed days); in-service beds exclude beds currently out of service.",
    filters: ["dateRange", "department"],
    columns: [{ key: "ward", label: "Ward" }, { key: "type", label: "Type" }, { key: "beds", label: "Beds", format: "int" }, { key: "occupied", label: "Occupied", format: "int" }, { key: "available", label: "Available", format: "int" }, { key: "reserved", label: "Reserved", format: "int" }, { key: "cleaning", label: "Cleaning", format: "int" }, { key: "outOfService", label: "Out of service", format: "int" }, { key: "occupancyNow", label: "Occupancy now", format: "percent" }, { key: "bedDays", label: "Occupied bed-days", format: "decimal" }, { key: "avgOccupancy", label: "Avg occupancy (period)", format: "percent" }],
    async run(f, ctx) {
      const wards = await prisma.ward.findMany({ where: { isActive: true, ...(f.departmentId ? { departmentId: f.departmentId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, beds: { select: { status: true } } } });
      const ids = wards.map((w) => w.id);
      const bedDays = ids.length ? await prisma.$queryRaw`
        SELECT b."wardId" AS id, SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(ba."endedAt", now()), ${f.end}::timestamptz, now()) - GREATEST(ba."startedAt", ${f.start}::timestamptz))) / 86400.0) AS days
        FROM "BedAssignment" ba JOIN "Bed" b ON b.id = ba."bedId"
        WHERE b."wardId" IN (${Prisma.join(ids)}) AND ba."startedAt" < LEAST(${f.end}::timestamptz, now()) AND COALESCE(ba."endedAt", now()) > ${f.start}::timestamptz
        GROUP BY 1` : [];
      const bd = new Map(bedDays.map((r) => [r.id, Math.max(0, Number(D(r.days).toFixed(1)))]));
      const elapsed = Math.max(0, (Math.min(f.end.getTime(), ctx.now.getTime()) - f.start.getTime()) / 86400000);
      const rows = wards.map((w) => {
        const c = (s) => w.beds.filter((b) => b.status === s).length;
        const inService = w.beds.length - c("OUT_OF_SERVICE");
        const days = bd.get(w.id) || 0;
        return {
          ward: w.name, type: w.type, beds: w.beds.length, occupied: c("OCCUPIED"), available: c("AVAILABLE"), reserved: c("RESERVED"), cleaning: c("CLEANING"), outOfService: c("OUT_OF_SERVICE"),
          occupancyNow: pct(c("OCCUPIED"), inService), bedDays: days, avgOccupancy: elapsed > 0 ? pct(days, inService * elapsed) : null,
        };
      });
      const beds = sumBy(rows, "beds"), occ = sumBy(rows, "occupied"), oos = sumBy(rows, "outOfService");
      return {
        rows,
        summary: [{ label: "Beds", value: beds, format: "int" }, { label: "Occupied now", value: occ, format: "int" }, { label: "Available now", value: sumBy(rows, "available"), format: "int" }, { label: "Occupancy now", value: pct(occ, beds - oos), format: "percent" }, { label: "Occupied bed-days", value: Number(sumBy(rows, "bedDays").toFixed(1)), format: "decimal" }],
        chart: { kind: "category", data: rows.map((r) => ({ label: r.ward, occupied: r.occupied, available: r.available })), series: [{ key: "occupied", label: "Occupied", color: "primary" }, { key: "available", label: "Available", color: "teal" }], yLabel: "Beds", stacked: true },
      };
    },
  },
  {
    key: "emergency", title: "Emergency department", category: "Inpatient & emergency", requires: READ,
    description: "ED arrivals per day, arrival mode, dispositions and triage mix.",
    definition: "Emergency visits by arrival time (hospital time zone). Dispositions reflect each visit's current status. Triage categories are those assigned by staff (never computed).",
    filters: ["dateRange", "status"], statusOptions: opts(ER_STATUSES),
    columns: [{ key: "date", label: "Date", format: "date" }, { key: "arrivals", label: "Arrivals", format: "int" }, { key: "ambulance", label: "By ambulance", format: "int" }, { key: "admitted", label: "Admitted", format: "int" }, { key: "discharged", label: "Discharged", format: "int" }, { key: "transferred", label: "Transferred", format: "int" }, { key: "lwbs", label: "Left without being seen", format: "int" }],
    async run(f, ctx) {
      const conds = [Prisma.sql`"arrivedAt" >= ${f.start}`, Prisma.sql`"arrivedAt" < ${f.end}`];
      if (f.status) conds.push(Prisma.sql`status::text = ${f.status}`);
      const [rows, triage] = await Promise.all([
        prisma.$queryRaw`SELECT to_char(("arrivedAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, count(*)::int AS arrivals,
          count(*) FILTER (WHERE "arrivalMode" = 'AMBULANCE')::int AS ambulance, count(*) FILTER (WHERE status = 'ADMITTED')::int AS admitted,
          count(*) FILTER (WHERE status = 'DISCHARGED')::int AS discharged, count(*) FILTER (WHERE status = 'TRANSFERRED')::int AS transferred,
          count(*) FILTER (WHERE status = 'LEFT_WITHOUT_BEING_SEEN')::int AS lwbs
          FROM "EmergencyVisit" WHERE ${sqlAnd(conds)} GROUP BY 1`,
        prisma.emergencyVisit.groupBy({ by: ["triageCategory"], where: { arrivedAt: { gte: f.start, lt: f.end }, ...(f.status ? { status: f.status } : {}) }, _count: { _all: true } }),
      ]);
      const data = fillDaily(f.days, new Map(rows.map((r) => [r.day, r])), ["arrivals", "ambulance", "admitted", "discharged", "transferred", "lwbs"]);
      const cats = ctx.settings.emergency?.triageCategories || [];
      const triageSummary = cats.map((c) => ({ label: `Triage: ${c.label}`, value: triage.find((t) => t.triageCategory === c.key)?._count._all ?? 0, format: "int" }));
      const untriaged = triage.find((t) => t.triageCategory == null)?._count._all ?? 0;
      return {
        rows: data,
        summary: [{ label: "Arrivals", value: sumBy(data, "arrivals"), format: "int" }, { label: "By ambulance", value: sumBy(data, "ambulance"), format: "int" }, { label: "Admitted", value: sumBy(data, "admitted"), format: "int" }, { label: "Left without being seen", value: sumBy(data, "lwbs"), format: "int" }, ...triageSummary, { label: "Not yet triaged", value: untriaged, format: "int" }],
        chart: { kind: "bar", data, series: [{ key: "arrivals", label: "Arrivals", color: "red" }], yLabel: "Visits" },
      };
    },
  },
  {
    key: "laboratory-tests", title: "Laboratory tests", category: "Diagnostics", requires: READ,
    description: "Tests ordered by test type and status, with turnaround times.",
    definition: "Test lines on lab orders placed in the period (order date, hospital time zone). Turnaround (TAT) = order placed → results released, for released orders, in hours. Within target = released within the test's configured turnaround hours.",
    filters: ["dateRange", "doctor", "status"], statusLabel: "Order status", statusOptions: opts(LAB_STATUSES),
    columns: [{ key: "code", label: "Code" }, { key: "test", label: "Test" }, { key: "category", label: "Category" }, { key: "ordered", label: "Ordered", format: "int" }, { key: "released", label: "Released", format: "int" }, { key: "pending", label: "Pending", format: "int" }, { key: "cancelled", label: "Cancelled / rejected", format: "int" }, { key: "avgTat", label: "Avg TAT", format: "hours" }, { key: "medianTat", label: "Median TAT", format: "hours" }, { key: "targetTat", label: "Target TAT", format: "hours" }, { key: "withinTarget", label: "Within target", format: "percent" }],
    async run(f) {
      const conds = [Prisma.sql`o."createdAt" >= ${f.start}`, Prisma.sql`o."createdAt" < ${f.end}`];
      if (f.doctorId) conds.push(Prisma.sql`o."doctorId" = ${f.doctorId}`);
      if (f.status) conds.push(Prisma.sql`o.status::text = ${f.status}`);
      const tatExpr = Prisma.sql`EXTRACT(EPOCH FROM (o."releasedAt" - o."createdAt")) / 3600.0`;
      const released = Prisma.sql`o.status = 'RELEASED' AND o."releasedAt" IS NOT NULL`;
      const [rows, orders] = await Promise.all([
        prisma.$queryRaw`SELECT t.code, t.name, t.category, t."turnaroundHours" AS target, count(*)::int AS ordered,
          count(*) FILTER (WHERE o.status = 'RELEASED')::int AS released,
          count(*) FILTER (WHERE o.status::text IN (${Prisma.join(LAB_PENDING)}))::int AS pending,
          count(*) FILTER (WHERE o.status IN ('CANCELLED', 'REJECTED'))::int AS cancelled,
          AVG(${tatExpr}) FILTER (WHERE ${released}) AS avg_tat,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ${tatExpr}) FILTER (WHERE ${released}) AS median_tat,
          count(*) FILTER (WHERE ${released} AND ${tatExpr} <= t."turnaroundHours")::int AS within
          FROM "LabOrderItem" i JOIN "LabOrder" o ON o.id = i."orderId" JOIN "LaboratoryTest" t ON t.id = i."testId"
          WHERE ${sqlAnd(conds)} GROUP BY t.id ORDER BY ordered DESC, t.name ASC`,
        prisma.$queryRaw`SELECT count(*)::int AS n, AVG(${tatExpr}) FILTER (WHERE ${released}) AS avg_tat FROM "LabOrder" o WHERE ${sqlAnd(conds)}`,
      ]);
      const out = rows.map((r) => ({
        code: r.code, test: r.name, category: r.category, ordered: r.ordered, released: r.released, pending: r.pending, cancelled: r.cancelled,
        avgTat: num1(r.avg_tat), medianTat: num1(r.median_tat), targetTat: r.target, withinTarget: pct(r.within, r.released),
      }));
      return {
        rows: out,
        summary: [{ label: "Lab orders", value: orders[0]?.n ?? 0, format: "int" }, { label: "Tests ordered", value: sumBy(out, "ordered"), format: "int" }, { label: "Tests released", value: sumBy(out, "released"), format: "int" }, { label: "Tests pending", value: sumBy(out, "pending"), format: "int" }, { label: "Avg order TAT", value: num1(orders[0]?.avg_tat), format: "hours" }],
        chart: { kind: "category", data: out.slice(0, 10).map((r) => ({ label: r.test, released: r.released, pending: r.pending })), series: [{ key: "released", label: "Released", color: "primary" }, { key: "pending", label: "Pending", color: "amber" }], stacked: true, yLabel: "Tests" },
      };
    },
  },
  {
    key: "pharmacy-sales", title: "Pharmacy sales", category: "Pharmacy & inventory", requires: FIN,
    description: "Dispensed quantity and value per medicine.",
    definition: "Units issued by DISPENSE stock movements in the period (movement date, hospital time zone) × the medicine's current selling price. Historical prices are not stored per movement, so value uses today's price; returns are not netted.",
    filters: ["dateRange"],
    columns: [{ key: "code", label: "Code" }, { key: "medicine", label: "Medicine" }, { key: "brand", label: "Brand" }, { key: "dispenses", label: "Dispense lines", format: "int" }, { key: "quantity", label: "Units", format: "int" }, { key: "price", label: "Selling price", format: "money" }, { key: "value", label: "Value", format: "money" }],
    async run(f) {
      const rows = await prisma.$queryRaw`SELECT m.code, m."genericName" AS generic, m.strength, m."brandName" AS brand, count(*)::int AS lines, (-SUM(sm.quantity))::int AS qty, m."sellingPrice" AS price, (-SUM(sm.quantity)) * m."sellingPrice" AS value
        FROM "StockMovement" sm JOIN "Medication" m ON m.id = sm."medicationId"
        WHERE sm.type = 'DISPENSE' AND sm."createdAt" >= ${f.start} AND sm."createdAt" < ${f.end}
        GROUP BY m.id ORDER BY value DESC, m."genericName" ASC`;
      const out = rows.map((r) => ({ code: r.code, medicine: `${r.generic} ${r.strength}`, brand: r.brand || "—", dispenses: r.lines, quantity: r.qty, price: toMoneyString(D(r.price)), value: toMoneyString(D(r.value)) }));
      return {
        rows: out,
        summary: [{ label: "Medicines dispensed", value: out.length, format: "int" }, { label: "Units", value: sumBy(out, "quantity"), format: "int" }, { label: "Dispense lines", value: sumBy(out, "dispenses"), format: "int" }, { label: "Sales value", value: sumMoney(out, "value"), format: "money" }],
        chart: { kind: "category", data: out.slice(0, 10).map((r) => ({ label: r.medicine, value: Number(r.value) })), series: [{ key: "value", label: "Value", color: "teal" }], yLabel: "Value", money: true },
      };
    },
  },
  {
    key: "medicine-stock", title: "Medicine stock", category: "Pharmacy & inventory", requires: READ,
    description: "On-hand quantity, usable stock and reorder status per medicine.",
    definition: "On hand = sum of all batch quantities right now; usable = batches not yet expired. Low = on hand at or below the reorder level; Out = nothing on hand. Snapshot — not affected by dates.",
    filters: ["status"], statusLabel: "Stock status", statusOptions: [{ value: "OUT", label: "Out of stock" }, { value: "LOW", label: "Low (≤ reorder level)" }, { value: "OK", label: "Above reorder level" }],
    columns: [{ key: "code", label: "Code" }, { key: "medicine", label: "Medicine" }, { key: "form", label: "Form" }, { key: "onHand", label: "On hand", format: "int" }, { key: "usable", label: "Usable (not expired)", format: "int" }, { key: "reorderLevel", label: "Reorder level", format: "int" }, { key: "stockStatus", label: "Status", format: "status" }, { key: "batches", label: "Batches", format: "int" }, { key: "nearestExpiry", label: "Nearest expiry", format: "dateOnly" }],
    async run(f) {
      const rows = await prisma.$queryRaw`SELECT m.code, m."genericName" AS generic, m.strength, m."dosageForm" AS form, m."reorderLevel" AS reorder,
        COALESCE(SUM(b.quantity), 0)::int AS on_hand, COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${f.today}::date), 0)::int AS usable,
        count(b.id) FILTER (WHERE b.quantity > 0)::int AS batches, MIN(b."expiryDate") FILTER (WHERE b.quantity > 0) AS nearest
        FROM "Medication" m LEFT JOIN "MedicationBatch" b ON b."medicationId" = m.id
        WHERE m."isActive" = true GROUP BY m.id ORDER BY m."genericName" ASC, m.strength ASC`;
      const all = rows.map((r) => ({
        code: r.code, medicine: `${r.generic} ${r.strength}`, form: r.form, onHand: r.on_hand, usable: r.usable, reorderLevel: r.reorder,
        stockStatus: r.on_hand === 0 ? "OUT" : r.on_hand <= r.reorder ? "LOW" : "OK", batches: r.batches, nearestExpiry: r.nearest,
      }));
      const out = f.status ? all.filter((r) => r.stockStatus === f.status) : all;
      return {
        rows: out,
        summary: [{ label: "Medicines", value: all.length, format: "int" }, { label: "Low stock", value: all.filter((r) => r.stockStatus === "LOW").length, format: "int" }, { label: "Out of stock", value: all.filter((r) => r.stockStatus === "OUT").length, format: "int" }, { label: "Units on hand", value: sumBy(all, "onHand"), format: "int" }],
      };
    },
  },
  {
    key: "expiry", title: "Batch expiry", category: "Pharmacy & inventory", requires: READ,
    description: "Batches with stock that have expired or will expire soon.",
    definition: "Medicine batches with quantity > 0 whose expiry date is past (expired) or within the selected window from today. The default window is the pharmacy expiry-alert setting.",
    filters: ["status"], statusLabel: "Window", defaultStatus: "ALERT",
    statusOptions: [{ value: "ALERT", label: "Alert window (setting)" }, { value: "EXPIRED", label: "Already expired" }, { value: "30", label: "Within 30 days" }, { value: "60", label: "Within 60 days" }, { value: "90", label: "Within 90 days" }, { value: "180", label: "Within 180 days" }],
    columns: [{ key: "medicine", label: "Medicine" }, { key: "batchNo", label: "Batch" }, { key: "expiryDate", label: "Expiry", format: "dateOnly" }, { key: "daysLeft", label: "Days left", format: "int" }, { key: "quantity", label: "Quantity", format: "int" }, { key: "supplier", label: "Supplier" }],
    async run(f, ctx) {
      const alertDays = Number(ctx.settings.pharmacy?.expiryAlertDays ?? 90);
      const today = new Date(f.today);
      const where = { quantity: { gt: 0 } };
      if (f.status === "EXPIRED") where.expiryDate = { lt: today };
      else where.expiryDate = { gte: today, lte: new Date(addDays(f.today, f.status && f.status !== "ALERT" ? Number(f.status) : alertDays)) };
      const [rows, expired] = await Promise.all([
        prisma.medicationBatch.findMany({ where, orderBy: { expiryDate: "asc" }, take: MAX_EXPORT_ROWS, select: { batchNo: true, expiryDate: true, quantity: true, medication: { select: { genericName: true, strength: true } }, supplier: { select: { name: true } } } }),
        prisma.medicationBatch.count({ where: { quantity: { gt: 0 }, expiryDate: { lt: today } } }),
      ]);
      const out = rows.map((b) => ({ medicine: `${b.medication.genericName} ${b.medication.strength}`, batchNo: b.batchNo, expiryDate: b.expiryDate, daysLeft: daysBetween(f.today, b.expiryDate.toISOString().slice(0, 10)), quantity: b.quantity, supplier: b.supplier?.name || "—" }));
      return {
        rows: out,
        summary: [{ label: "Batches listed", value: out.length, format: "int" }, { label: "Units", value: sumBy(out, "quantity"), format: "int" }, { label: "Expired batches still in stock", value: expired, format: "int" }, { label: "Alert window (days)", value: alertDays, format: "int" }],
      };
    },
  },
  {
    key: "inventory-valuation", title: "Inventory valuation", category: "Pharmacy & inventory", requires: FIN,
    description: "Value of medicines and general supplies on hand.",
    definition: "Current on-hand quantity × cost: medicine batches at their purchase cost (expired batches included), general inventory at unit cost. Snapshot — not affected by dates.",
    filters: ["status"], statusLabel: "Stock type", statusOptions: [{ value: "MEDICINE", label: "Medicines" }, { value: "SUPPLY", label: "General supplies" }],
    columns: [{ key: "type", label: "Type" }, { key: "code", label: "Code" }, { key: "name", label: "Item" }, { key: "category", label: "Category" }, { key: "quantity", label: "Quantity", format: "int" }, { key: "unitCost", label: "Avg unit cost", format: "money" }, { key: "value", label: "Value", format: "money" }],
    async run(f) {
      const [meds, items] = await Promise.all([
        f.status === "SUPPLY" ? [] : prisma.$queryRaw`SELECT m.code, m."genericName" AS generic, m.strength, COALESCE(m.category, 'Uncategorised') AS category, COALESCE(SUM(b.quantity), 0)::int AS qty, COALESCE(SUM(b.quantity * b."purchaseCost"), 0) AS value
          FROM "Medication" m LEFT JOIN "MedicationBatch" b ON b."medicationId" = m.id WHERE m."isActive" = true GROUP BY m.id HAVING COALESCE(SUM(b.quantity), 0) > 0 ORDER BY value DESC`,
        f.status === "MEDICINE" ? [] : prisma.inventoryItem.findMany({ where: { isActive: true, quantity: { gt: 0 } }, orderBy: { name: "asc" }, select: { code: true, name: true, category: true, quantity: true, unitCost: true } }),
      ]);
      const rows = [
        ...meds.map((m) => ({ type: "Medicine", code: m.code, name: `${m.generic} ${m.strength}`, category: m.category, quantity: m.qty, unitCost: toMoneyString(D(m.value).div(m.qty)), value: toMoneyString(D(m.value)) })),
        ...items.map((i) => ({ type: "Supply", code: i.code, name: i.name, category: i.category, quantity: i.quantity, unitCost: toMoneyString(D(i.unitCost)), value: toMoneyString(D(i.unitCost).mul(i.quantity)) })),
      ].sort((a, b) => Number(b.value) - Number(a.value));
      const byCat = new Map();
      for (const r of rows) byCat.set(r.category, (byCat.get(r.category) || D(0)).plus(D(r.value)));
      return {
        rows,
        summary: [{ label: "Medicines value", value: sumMoney(rows.filter((r) => r.type === "Medicine"), "value"), format: "money" }, { label: "Supplies value", value: sumMoney(rows.filter((r) => r.type === "Supply"), "value"), format: "money" }, { label: "Total value", value: sumMoney(rows, "value"), format: "money" }, { label: "Items", value: rows.length, format: "int" }],
        chart: { kind: "category", data: [...byCat].map(([label, v]) => ({ label, value: Number(v.toFixed(2)) })).sort((a, b) => b.value - a.value).slice(0, 10), series: [{ key: "value", label: "Value", color: "teal" }], yLabel: "Value", money: true },
      };
    },
  },
  {
    key: "revenue", title: "Revenue (invoiced)", category: "Finance", requires: FIN,
    description: "Invoiced amounts by service category.",
    definition: "Invoice lines on invoices issued in the period (issue date, hospital time zone), excluding draft and void invoices. Net = line totals after discounts, including tax. Cash actually received is in Payment collections.",
    filters: ["dateRange"],
    columns: [{ key: "category", label: "Category" }, { key: "lines", label: "Lines", format: "int" }, { key: "gross", label: "Gross", format: "money" }, { key: "discount", label: "Discounts", format: "money" }, { key: "tax", label: "Tax", format: "money" }, { key: "net", label: "Net invoiced", format: "money" }],
    async run(f) {
      const [rows, inv] = await Promise.all([
        prisma.$queryRaw`SELECT ii.category, count(*)::int AS lines, SUM(ii.quantity * ii."unitPrice") AS gross, SUM(ii.discount) AS discount, SUM(ii."lineTotal") AS net
          FROM "InvoiceItem" ii JOIN "Invoice" inv ON inv.id = ii."invoiceId"
          WHERE inv.status NOT IN ('DRAFT', 'VOID') AND inv."issuedAt" >= ${f.start} AND inv."issuedAt" < ${f.end}
          GROUP BY 1 ORDER BY net DESC`,
        prisma.invoice.count({ where: { status: { notIn: ["DRAFT", "VOID"] }, issuedAt: { gte: f.start, lt: f.end } } }),
      ]);
      const out = rows.map((r) => {
        const gross = D(r.gross), disc = D(r.discount), net = D(r.net);
        return { category: r.category, lines: r.lines, gross: toMoneyString(gross), discount: toMoneyString(disc), tax: toMoneyString(net.minus(gross.minus(disc))), net: toMoneyString(net) };
      });
      return {
        rows: out,
        summary: [{ label: "Invoices issued", value: inv, format: "int" }, { label: "Gross", value: sumMoney(out, "gross"), format: "money" }, { label: "Discounts", value: sumMoney(out, "discount"), format: "money" }, { label: "Tax", value: sumMoney(out, "tax"), format: "money" }, { label: "Net invoiced", value: sumMoney(out, "net"), format: "money" }],
        chart: { kind: "category", data: out.map((r) => ({ label: r.category, net: Number(r.net) })), series: [{ key: "net", label: "Net invoiced", color: "primary" }], yLabel: "Amount", money: true },
      };
    },
  },
  {
    key: "payment-collections", title: "Payment collections", category: "Finance", requires: FIN,
    description: "Cash collected per day by payment method, net of refunds.",
    definition: "Revenue collected = payments received minus refunds, by payment / refund date in the hospital time zone. The method filter applies to both payments and refunds.",
    filters: ["dateRange", "status"], statusLabel: "Method", statusOptions: opts(METHODS),
    columns: [{ key: "date", label: "Date", format: "date" }, { key: "CASH", label: "Cash", format: "money" }, { key: "CARD", label: "Card", format: "money" }, { key: "BANK_TRANSFER", label: "Bank transfer", format: "money" }, { key: "ONLINE", label: "Online", format: "money" }, { key: "count", label: "Payments", format: "int" }, { key: "gross", label: "Collected", format: "money" }, { key: "refunds", label: "Refunds", format: "money" }, { key: "net", label: "Net", format: "money" }],
    async run(f, ctx) {
      const pc = [Prisma.sql`"receivedAt" >= ${f.start}`, Prisma.sql`"receivedAt" < ${f.end}`];
      const rc = [Prisma.sql`"createdAt" >= ${f.start}`, Prisma.sql`"createdAt" < ${f.end}`];
      if (f.status) { pc.push(Prisma.sql`method = ${f.status}`); rc.push(Prisma.sql`method = ${f.status}`); }
      const [pay, ref] = await Promise.all([
        prisma.$queryRaw`SELECT to_char(("receivedAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, method, SUM(amount) AS amount, count(*)::int AS n FROM "Payment" WHERE ${sqlAnd(pc)} GROUP BY 1, 2`,
        prisma.$queryRaw`SELECT to_char(("createdAt" AT TIME ZONE ${ctx.tz}), 'YYYY-MM-DD') AS day, SUM(amount) AS amount FROM "Refund" WHERE ${sqlAnd(rc)} GROUP BY 1`,
      ]);
      const blank = () => ({ CASH: D(0), CARD: D(0), BANK_TRANSFER: D(0), ONLINE: D(0), gross: D(0), refunds: D(0), count: 0 });
      const byDay = new Map();
      for (const r of pay) {
        const o = byDay.get(r.day) || blank();
        if (o[r.method] !== undefined) o[r.method] = o[r.method].plus(D(r.amount));
        o.gross = o.gross.plus(D(r.amount)); o.count += r.n;
        byDay.set(r.day, o);
      }
      for (const r of ref) { const o = byDay.get(r.day) || blank(); o.refunds = o.refunds.plus(D(r.amount)); byDay.set(r.day, o); }
      const rows = f.days.map((d) => {
        const o = byDay.get(d) || blank();
        return { date: d, label: formatDayLabel(d), CASH: toMoneyString(o.CASH), CARD: toMoneyString(o.CARD), BANK_TRANSFER: toMoneyString(o.BANK_TRANSFER), ONLINE: toMoneyString(o.ONLINE), count: o.count, gross: toMoneyString(o.gross), refunds: toMoneyString(o.refunds), net: toMoneyString(o.gross.minus(o.refunds)) };
      });
      return {
        rows,
        summary: [{ label: "Collected", value: sumMoney(rows, "gross"), format: "money" }, { label: "Refunds", value: sumMoney(rows, "refunds"), format: "money" }, { label: "Net collected", value: sumMoney(rows, "net"), format: "money" }, { label: "Payments", value: sumBy(rows, "count"), format: "int" },
          ...METHODS.map((m) => ({ label: opts([m])[0].label, value: sumMoney(rows, m), format: "money" }))],
        chart: { kind: "bar", data: rows.map((r) => ({ label: r.label, net: Number(r.net) })), series: [{ key: "net", label: "Net collected", color: "teal" }], yLabel: "Amount", money: true },
      };
    },
  },
  {
    key: "outstanding-invoices", title: "Outstanding invoices", category: "Finance", requires: FIN,
    description: "Issued invoices with a balance due, with ageing buckets.",
    definition: "Invoices in status Issued or Partially paid with balance > 0, right now. Age = days since the issue date (hospital time zone). Snapshot — not affected by dates.",
    filters: ["status"], statusOptions: opts(["ISSUED", "PARTIALLY_PAID"]),
    columns: [{ key: "invoiceNo", label: "Invoice" }, { key: "mrn", label: "MRN" }, { key: "patient", label: "Patient" }, { key: "issuedAt", label: "Issued", format: "datetime" }, { key: "ageDays", label: "Age (days)", format: "int" }, { key: "bucket", label: "Ageing" }, { key: "total", label: "Total", format: "money" }, { key: "paid", label: "Paid", format: "money" }, { key: "balance", label: "Balance", format: "money" }, { key: "status", label: "Status", format: "status" }],
    async run(f, ctx) {
      const rows = await prisma.invoice.findMany({
        where: { status: f.status ? f.status : { in: ["ISSUED", "PARTIALLY_PAID"] }, balance: { gt: 0 } }, orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }], take: MAX_EXPORT_ROWS,
        select: { invoiceNo: true, status: true, issuedAt: true, createdAt: true, total: true, amountPaid: true, amountRefunded: true, balance: true, patient: { select: { mrn: true, firstName: true, lastName: true } } },
      });
      const bucketOf = (d) => (d <= 30 ? "0–30 days" : d <= 60 ? "31–60 days" : d <= 90 ? "61–90 days" : "90+ days");
      const out = rows.map((i) => {
        const issued = i.issuedAt || i.createdAt;
        const age = Math.max(0, daysBetween(toZonedDateString(issued, ctx.tz), f.today));
        return { invoiceNo: i.invoiceNo, mrn: i.patient.mrn, patient: fullName(i.patient), issuedAt: issued, ageDays: age, bucket: bucketOf(age), total: toMoneyString(i.total), paid: toMoneyString(D(i.amountPaid).minus(D(i.amountRefunded))), balance: toMoneyString(i.balance), status: i.status };
      });
      const buckets = ["0–30 days", "31–60 days", "61–90 days", "90+ days"];
      return {
        rows: out,
        summary: [{ label: "Invoices", value: out.length, format: "int" }, { label: "Total balance", value: sumMoney(out, "balance"), format: "money" }, ...buckets.map((b) => ({ label: b, value: sumMoney(out.filter((r) => r.bucket === b), "balance"), format: "money" }))],
        chart: { kind: "category", data: buckets.map((b) => ({ label: b, balance: Number(sumMoney(out.filter((r) => r.bucket === b), "balance")) })), series: [{ key: "balance", label: "Balance", color: "amber" }], yLabel: "Balance", money: true },
      };
    },
  },
  {
    key: "refunds", title: "Refunds", category: "Finance", requires: FIN,
    description: "Refunds issued in the period with reason and approver.",
    definition: "Refund records by refund date (hospital time zone).",
    filters: ["dateRange", "status"], statusLabel: "Method", statusOptions: opts(METHODS),
    columns: [{ key: "createdAt", label: "Date", format: "datetime" }, { key: "invoiceNo", label: "Invoice" }, { key: "mrn", label: "MRN" }, { key: "amount", label: "Amount", format: "money" }, { key: "method", label: "Method", format: "status" }, { key: "reason", label: "Reason" }, { key: "approvedBy", label: "Approved by" }],
    async run(f) {
      const rows = await prisma.refund.findMany({
        where: { createdAt: { gte: f.start, lt: f.end }, ...(f.status ? { method: f.status } : {}) }, orderBy: { createdAt: "desc" }, take: MAX_EXPORT_ROWS,
        select: { createdAt: true, amount: true, method: true, reason: true, approvedById: true, invoice: { select: { invoiceNo: true, patient: { select: { mrn: true } } } } },
      });
      const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.approvedById))] } }, select: { id: true, name: true } });
      const name = new Map(users.map((u) => [u.id, u.name]));
      const out = rows.map((r) => ({ createdAt: r.createdAt, invoiceNo: r.invoice.invoiceNo, mrn: r.invoice.patient.mrn, amount: toMoneyString(r.amount), method: r.method, reason: r.reason, approvedBy: name.get(r.approvedById) || "—" }));
      return { rows: out, summary: [{ label: "Refunds", value: out.length, format: "int" }, { label: "Total refunded", value: sumMoney(out, "amount"), format: "money" }] };
    },
  },
  {
    key: "insurance-claims", title: "Insurance claims", category: "Finance", requires: FIN,
    description: "Claims raised in the period by provider and status.",
    definition: "Insurance claims by creation date (hospital time zone). Approval rate = approved amount ÷ claimed amount for claims with a decision.",
    filters: ["dateRange", "status"], statusOptions: opts(CLAIM_STATUSES),
    columns: [{ key: "claimNo", label: "Claim" }, { key: "provider", label: "Provider" }, { key: "policyNumber", label: "Policy" }, { key: "invoiceNo", label: "Invoice" }, { key: "mrn", label: "MRN" }, { key: "claimAmount", label: "Claimed", format: "money" }, { key: "approvedAmount", label: "Approved", format: "money" }, { key: "status", label: "Status", format: "status" }, { key: "submittedAt", label: "Submitted", format: "datetime" }],
    async run(f) {
      const rows = await prisma.insuranceClaim.findMany({
        where: { createdAt: { gte: f.start, lt: f.end }, ...(f.status ? { status: f.status } : {}) }, orderBy: { createdAt: "desc" }, take: MAX_EXPORT_ROWS,
        select: { claimNo: true, claimAmount: true, approvedAmount: true, status: true, submittedAt: true, policy: { select: { policyNumber: true, provider: { select: { name: true } } } }, invoice: { select: { invoiceNo: true, patient: { select: { mrn: true } } } } },
      });
      const out = rows.map((c) => ({ claimNo: c.claimNo, provider: c.policy.provider.name, policyNumber: c.policy.policyNumber, invoiceNo: c.invoice.invoiceNo, mrn: c.invoice.patient.mrn, claimAmount: toMoneyString(c.claimAmount), approvedAmount: c.approvedAmount == null ? null : toMoneyString(c.approvedAmount), status: c.status, submittedAt: c.submittedAt }));
      const decided = out.filter((c) => ["APPROVED", "PARTIALLY_APPROVED", "REJECTED", "PAID"].includes(c.status));
      const claimedDecided = Number(sumMoney(decided, "claimAmount"));
      return {
        rows: out,
        summary: [{ label: "Claims", value: out.length, format: "int" }, { label: "Claimed", value: sumMoney(out, "claimAmount"), format: "money" }, { label: "Approved", value: sumMoney(out, "approvedAmount"), format: "money" }, { label: "Approval rate", value: pct(Number(sumMoney(decided, "approvedAmount")), claimedDecided), format: "percent" },
          ...CLAIM_STATUSES.map((s) => ({ label: opts([s])[0].label, value: out.filter((c) => c.status === s).length, format: "int" })).filter((s) => s.value > 0)],
      };
    },
  },
  {
    key: "staff-attendance", title: "Staff attendance", category: "Staff", requires: ["reports:read", "hr:read"],
    description: "Attendance status counts and rate per employee.",
    definition: "Attendance records dated within the period. Attendance rate = (present + late + ½ × half-day) ÷ days recorded. Terminated staff appear only if they have records in the period.",
    filters: ["dateRange", "department"],
    columns: [{ key: "employeeNo", label: "Employee" }, { key: "name", label: "Name" }, { key: "department", label: "Department" }, { key: "position", label: "Position" }, { key: "present", label: "Present", format: "int" }, { key: "late", label: "Late", format: "int" }, { key: "halfDay", label: "Half day", format: "int" }, { key: "absent", label: "Absent", format: "int" }, { key: "onLeave", label: "On leave", format: "int" }, { key: "recorded", label: "Days recorded", format: "int" }, { key: "rate", label: "Attendance rate", format: "percent" }],
    async run(f) {
      const dateRange = { gte: new Date(f.from), lte: new Date(f.to) };
      const dept = f.departmentId ? { departmentId: f.departmentId } : {};
      const [staff, groups] = await Promise.all([
        prisma.staff.findMany({ where: { ...dept, OR: [{ employmentStatus: { not: "TERMINATED" } }, { attendance: { some: { date: dateRange } } }] }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, employeeNo: true, firstName: true, lastName: true, position: true, department: { select: { name: true } } } }),
        prisma.employeeAttendance.groupBy({ by: ["staffId", "status"], where: { date: dateRange, ...(f.departmentId ? { staff: { departmentId: f.departmentId } } : {}) }, _count: { _all: true } }),
      ]);
      const rows = staff.map((s) => {
        const c = (st) => groups.find((g) => g.staffId === s.id && g.status === st)?._count._all ?? 0;
        const present = c("PRESENT"), late = c("LATE"), halfDay = c("HALF_DAY"), absent = c("ABSENT"), onLeave = c("ON_LEAVE");
        const recorded = present + late + halfDay + absent + onLeave;
        return { employeeNo: s.employeeNo, name: fullName(s), department: s.department?.name || "—", position: s.position, present, late, halfDay, absent, onLeave, recorded, rate: pct(present + late + halfDay / 2, recorded) };
      });
      const recorded = sumBy(rows, "recorded");
      return {
        rows,
        summary: [{ label: "Staff", value: rows.length, format: "int" }, { label: "Records", value: recorded, format: "int" }, { label: "Absences", value: sumBy(rows, "absent"), format: "int" }, { label: "Late arrivals", value: sumBy(rows, "late"), format: "int" }, { label: "Overall attendance", value: pct(sumBy(rows, "present") + sumBy(rows, "late") + sumBy(rows, "halfDay") / 2, recorded), format: "percent" }],
      };
    },
  },
];

export const REPORT_MAP = new Map(REPORTS.map((r) => [r.key, r]));
export const getReport = (key) => REPORT_MAP.get(key) || null;

export function canViewReport(session, report) {
  return report.requires.every((p) => session.permissions.has(p));
}
export function canExportReport(session, report) {
  return canViewReport(session, report) && session.permissions.has("reports:export");
}
export function reportsFor(session) {
  return REPORTS.filter((r) => canViewReport(session, r));
}

// ───────────────────────────── Filters ─────────────────────────────

const ID_RE = /^[a-z0-9_-]{8,64}$/i;

/** Normalise raw query params into the filters a report understands (pure apart from `now`). */
export function resolveReportFilters(report, raw = {}, tz, now = new Date()) {
  const today = todayInTz(tz);
  const uses = (k) => report.filters.includes(k);
  let from = uses("dateRange") && isDateString(raw.from) ? raw.from : addDays(today, -29);
  let to = uses("dateRange") && isDateString(raw.to) ? raw.to : today;
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) >= MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  const statusValues = (report.statusOptions || []).map((o) => o.value);
  const status = uses("status") && statusValues.includes(raw.status) ? raw.status : report.defaultStatus ?? "";
  return {
    from, to, today, now,
    start: dayRangeUtc(from, tz)[0], end: dayRangeUtc(to, tz)[1], days: dayList(from, to),
    departmentId: uses("department") && ID_RE.test(raw.departmentId || "") ? raw.departmentId : "",
    doctorId: uses("doctor") && ID_RE.test(raw.doctorId || "") ? raw.doctorId : "",
    status,
  };
}

/** Only the filters that are meaningful for URLs / audit metadata. */
export function filterParams(report, f) {
  const p = {};
  if (report.filters.includes("dateRange")) { p.from = f.from; p.to = f.to; }
  if (f.departmentId) p.departmentId = f.departmentId;
  if (f.doctorId) p.doctorId = f.doctorId;
  if (f.status) p.status = f.status;
  return p;
}

export async function runReport(report, raw, hospital) {
  const ctx = { tz: hospital.timezone, settings: hospital.settings, currency: hospital.currency, locale: hospital.locale, now: new Date() };
  const f = resolveReportFilters(report, raw, ctx.tz, ctx.now);
  const result = await report.run(f, ctx);
  return { filters: f, ...result, rows: result.rows.slice(0, MAX_EXPORT_ROWS), truncated: result.rows.length > MAX_EXPORT_ROWS };
}

export async function reportFilterOptions(report) {
  const [departments, doctors] = await Promise.all([
    report.filters.includes("department") ? prisma.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    report.filters.includes("doctor") ? prisma.doctorProfile.findMany({ orderBy: { staff: { lastName: "asc" } }, select: { id: true, staff: { select: { firstName: true, lastName: true } } } }) : [],
  ]);
  return {
    departments: departments.map((d) => ({ value: d.id, label: d.name })),
    doctors: doctors.map((d) => ({ value: d.id, label: `Dr. ${fullName(d.staff)}` })),
  };
}

// ───────────────────────────── Cell formatting (screen + CSV) ─────────────────────────────

export function formatCell(value, format, ctx) {
  if (value == null || value === "") return "—";
  switch (format) {
    case "int": return Number(value).toLocaleString("en-US");
    case "decimal": return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
    case "money": return formatMoney(value, ctx.currency, ctx.locale);
    case "percent": return `${Number(value).toFixed(1)}%`;
    case "hours": return `${Number(value).toFixed(1)} h`;
    case "date": return formatDateOnly(new Date(`${value}T00:00:00Z`));
    case "dateOnly": return formatDateOnly(value);
    case "datetime": return formatDateTime(value, ctx.tz);
    case "status": return String(value).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    default: return String(value);
  }
}

/** Raw, spreadsheet-friendly value for CSV (numbers stay numeric, money is a plain decimal string). */
export function csvValue(value, format, ctx) {
  if (value == null) return "";
  switch (format) {
    case "money": return toMoneyString(value);
    case "date": return value;
    case "dateOnly": return new Date(value).toISOString().slice(0, 10);
    case "datetime": return `${toZonedDateString(value, ctx.tz)} ${toZonedTimeString(value, ctx.tz)}`;
    default: return value;
  }
}

export function csvColumns(report, ctx) {
  return report.columns.map((c) => ({ label: c.format === "money" ? `${c.label} (${ctx.currency})` : c.format === "hours" ? `${c.label} (hours)` : c.format === "percent" ? `${c.label} (%)` : c.label, value: (r) => csvValue(r[c.key], c.format, ctx) }));
}
