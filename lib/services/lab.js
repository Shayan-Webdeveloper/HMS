import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState, forbidden, badRequest } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { dayRangeUtc, todayInTz } from "@/lib/utils/time";
import { toMoneyString } from "@/lib/utils/money";
import { can } from "@/lib/auth/session";
import { patientSearchWhere } from "@/lib/services/patients";
import { notifyPermission, notifyUser } from "@/lib/services/notifications";
import { getSetting } from "@/lib/services/settings";
import {
  LAB_STATUSES, LAB_ACTIVE_STATUSES, LAB_STATUS_LABELS, canTransitionLab, planSegments,
  parseNumericValue, formatReferenceRange, flagForResult,
} from "@/lib/validation/lab";

const ci = (v) => ({ contains: v, mode: "insensitive" });
const statusLabel = (s) => LAB_STATUS_LABELS[s] || s;

// ═════════════════════════ Test catalogue ═════════════════════════

const TEST_PUBLIC = { id: true, code: true, name: true, category: true, price: true, specimenType: true };

/** Contract for GET /api/lab/tests: active catalogue only. */
export async function searchActiveTests({ q, take = 50 }) {
  const where = { isActive: true };
  if (q) where.OR = [{ code: ci(q) }, { name: ci(q) }, { category: ci(q) }];
  const rows = await prisma.laboratoryTest.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }], take, select: TEST_PUBLIC });
  return rows.map((t) => ({ ...t, price: toMoneyString(t.price) }));
}

/** Full active catalogue for the ordering form (small table; includes TAT and ranges for display). */
export async function listOrderableTests() {
  return prisma.laboratoryTest.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { ...TEST_PUBLIC, unit: true, turnaroundHours: true, referenceLow: true, referenceHigh: true, referenceText: true },
  });
}

const TEST_SORT = { code: "code", name: "name", category: "category", price: "price", turnaroundHours: "turnaroundHours" };

export async function listLabTests({ q, page, pageSize, sort, dir, status, category }) {
  const where = {};
  if (status === "INACTIVE") where.isActive = false;
  else if (status !== "ALL") where.isActive = true;
  if (category) where.category = category;
  if (q) where.OR = [{ code: ci(q) }, { name: ci(q) }, { category: ci(q) }, { specimenType: ci(q) }];
  const orderBy = sort && TEST_SORT[sort] ? [{ [TEST_SORT[sort]]: dir }] : [{ category: "asc" }, { name: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.laboratoryTest.count({ where }),
    prisma.laboratoryTest.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { orderItems: true } } } }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function labCatalogFacets() {
  const [cats, specs, units] = await Promise.all([
    prisma.laboratoryTest.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    prisma.laboratoryTest.findMany({ distinct: ["specimenType"], select: { specimenType: true }, orderBy: { specimenType: "asc" } }),
    prisma.laboratoryTest.findMany({ distinct: ["unit"], where: { unit: { not: null } }, select: { unit: true }, orderBy: { unit: "asc" } }),
  ]);
  return { categories: cats.map((c) => c.category), specimenTypes: specs.map((s) => s.specimenType), units: units.map((u) => u.unit) };
}

function testData(input) {
  return {
    code: input.code,
    name: input.name,
    category: input.category,
    specimenType: input.specimenType,
    unit: input.unit ?? null,
    referenceLow: input.referenceLow ?? null,
    referenceHigh: input.referenceHigh ?? null,
    referenceText: input.referenceText ?? null,
    price: input.price,
    turnaroundHours: input.turnaroundHours,
  };
}

export async function createLabTest(input, session, ip) {
  const dup = await prisma.laboratoryTest.findUnique({ where: { code: input.code }, select: { id: true } });
  if (dup) throw conflict("A test with this code already exists.", { code: "Code already in use" });
  return prisma.$transaction(async (tx) => {
    const t = await tx.laboratoryTest.create({ data: testData(input) });
    await audit({ userId: session.user.id, action: "lab.test.create", entityType: "LaboratoryTest", entityId: t.id, metadata: { code: t.code }, ipAddress: ip }, tx);
    return t;
  });
}

export async function updateLabTest(id, input, session, ip) {
  const existing = await prisma.laboratoryTest.findUnique({ where: { id } });
  if (!existing) throw notFound("Test not found");
  if (input.code !== existing.code) {
    const dup = await prisma.laboratoryTest.findUnique({ where: { code: input.code }, select: { id: true } });
    if (dup) throw conflict("A test with this code already exists.", { code: "Code already in use" });
  }
  const data = testData(input);
  const norm = (v) => (v == null ? "" : String(v).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""));
  const changed = Object.keys(data).filter((k) => norm(existing[k]) !== norm(data[k]));
  return prisma.$transaction(async (tx) => {
    const t = await tx.laboratoryTest.update({ where: { id }, data });
    // Ordered items keep their snapshotted price; only future orders use the new configuration.
    await audit({ userId: session.user.id, action: "lab.test.update", entityType: "LaboratoryTest", entityId: id, metadata: { code: t.code, fields: changed }, ipAddress: ip }, tx);
    return t;
  });
}

export async function setLabTestActive(id, isActive, session, ip) {
  const existing = await prisma.laboratoryTest.findUnique({ where: { id }, select: { id: true, code: true, isActive: true } });
  if (!existing) throw notFound("Test not found");
  if (existing.isActive === isActive) throw invalidState(isActive ? "Test is already active." : "Test is already inactive.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.laboratoryTest.updateMany({ where: { id, isActive: !isActive }, data: { isActive } });
    if (!r.count) throw conflict("The test was changed by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: isActive ? "lab.test.activate" : "lab.test.deactivate", entityType: "LaboratoryTest", entityId: id, metadata: { code: existing.code }, ipAddress: ip }, tx);
    return { id, isActive };
  });
}

// ═════════════════════════ Ordering ═════════════════════════

export async function assertOrderablePatient(db, patientId, encounterId) {
  const patient = await db.patient.findUnique({ where: { id: patientId }, select: { id: true, status: true } });
  if (!patient || patient.status === "MERGED") throw notFound("Patient not found");
  if (patient.status !== "ACTIVE") throw invalidState("Orders can only be placed for active patients.");
  if (encounterId) {
    const enc = await db.encounter.findFirst({ where: { id: encounterId, patientId }, select: { id: true, status: true } });
    if (!enc) throw invalidState("The selected encounter does not belong to this patient.");
    if (!["DRAFT", "FINALIZED"].includes(enc.status)) throw invalidState("Orders cannot be linked to a cancelled encounter.");
  }
  return patient;
}

/**
 * POST /api/lab/orders contract: { patientId, encounterId?, testIds[], priority, clinicalNotes? }.
 * The ordering doctor is always the signed-in user's doctor profile.
 */
export async function createLabOrder(input, session, ip) {
  if (!session.doctorId) throw forbidden("Lab orders must be placed by a doctor. Your account has no doctor profile.");
  await assertOrderablePatient(prisma, input.patientId, input.encounterId);
  const tests = await prisma.laboratoryTest.findMany({ where: { id: { in: input.testIds }, isActive: true }, select: { id: true, price: true } });
  if (tests.length !== input.testIds.length) throw invalidState("One or more selected tests are inactive or no longer available.");
  const priceOf = new Map(tests.map((t) => [t.id, t.price]));
  return prisma.$transaction(async (tx) => {
    const orderNo = await newId(tx, "labOrder");
    const order = await tx.labOrder.create({
      data: {
        orderNo,
        patientId: input.patientId,
        doctorId: session.doctorId,
        encounterId: input.encounterId ?? null,
        priority: input.priority,
        clinicalNotes: input.clinicalNotes ?? null,
        // Price is snapshotted so later catalogue changes never alter what was ordered/billed.
        items: { create: input.testIds.map((testId) => ({ testId, price: priceOf.get(testId) })) },
      },
      include: { items: { select: { id: true, testId: true, price: true } } },
    });
    await audit({ userId: session.user.id, action: "lab.order.create", entityType: "LabOrder", entityId: order.id, metadata: { orderNo, priority: order.priority, testCount: order.items.length, patientId: input.patientId, encounterId: input.encounterId ?? null }, ipAddress: ip }, tx);
    await notifyPermission(["lab:process"], {
      category: "LAB",
      title: order.priority === "ROUTINE" ? "New lab order" : `${order.priority} lab order received`,
      body: `Order ${orderNo} is awaiting specimen collection.`,
      link: `/laboratory/${order.id}`,
    }, tx);
    return { id: order.id, orderNo: order.orderNo, status: order.status, priority: order.priority, patientId: order.patientId, encounterId: order.encounterId, doctorId: order.doctorId, items: order.items, createdAt: order.createdAt };
  });
}

// ═════════════════════════ Worklist ═════════════════════════

const ACTIVE_TABS = new Set(["ACTIVE", ...LAB_ACTIVE_STATUSES]);

export function labOrderWhere({ q, status, priority, from, to, mine, patientId, encounterId }, tz, session) {
  const and = [];
  if (patientId) and.push({ patientId });
  if (encounterId) and.push({ encounterId });
  const st = status || "ACTIVE";
  if (st === "ACTIVE") and.push({ status: { in: LAB_ACTIVE_STATUSES } });
  else if (LAB_STATUSES.includes(st)) and.push({ status: st });
  if (priority) and.push({ priority });
  if (mine && session?.doctorId) and.push({ doctorId: session.doctorId });
  if (from || to) {
    const createdAt = {};
    if (from) createdAt.gte = dayRangeUtc(from, tz)[0];
    if (to) createdAt.lt = dayRangeUtc(to, tz)[1];
    and.push({ createdAt });
  }
  if (q) and.push({ OR: [{ orderNo: ci(q) }, { specimens: { some: { specimenNo: ci(q) } } }, { patient: patientSearchWhere(q) }] });
  return and.length ? { AND: and } : {};
}

const LIST_INCLUDE = {
  patient: { select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true } },
  doctor: { select: { id: true, staff: { select: { firstName: true, lastName: true } } } },
  items: { select: { id: true, test: { select: { code: true, name: true } } }, orderBy: { id: "asc" } },
};

const SEGMENT_WHERE = {
  STAT: { priority: "STAT" },
  URGENT: { priority: "URGENT" },
  ROUTINE: { priority: { notIn: ["STAT", "URGENT"] } },
};

export function defaultLabSort(status) {
  return ACTIVE_TABS.has(status || "ACTIVE") ? "priority" : "createdAt";
}

export async function listLabOrders(query, tz, session) {
  const where = labOrderWhere(query, tz, session);
  const { page, pageSize } = query;
  const dir = query.dir || "desc";
  const sort = query.sort || defaultLabSort(query.status);
  const skip = (page - 1) * pageSize;

  if (sort === "priority") {
    // Most urgent first (dir=desc), oldest first within each priority (bench FIFO).
    const keys = dir === "asc" ? ["ROUTINE", "URGENT", "STAT"] : ["STAT", "URGENT", "ROUTINE"];
    const countList = await Promise.all(keys.map((k) => prisma.labOrder.count({ where: { AND: [where, SEGMENT_WHERE[k]] } })));
    const counts = Object.fromEntries(keys.map((k, i) => [k, countList[i]]));
    const total = countList.reduce((a, b) => a + b, 0);
    const plan = planSegments(counts, keys, skip, pageSize);
    const parts = await Promise.all(plan.map((p) => prisma.labOrder.findMany({
      where: { AND: [where, SEGMENT_WHERE[p.key]] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: p.skip, take: p.take, include: LIST_INCLUDE,
    })));
    return { rows: parts.flat(), meta: pageMeta(total, page, pageSize), sort };
  }

  const orderBy = sort === "orderNo" ? [{ orderNo: dir }] : [{ createdAt: dir }, { id: dir }];
  const [total, rows] = await Promise.all([
    prisma.labOrder.count({ where }),
    prisma.labOrder.findMany({ where, orderBy, skip, take: pageSize, include: LIST_INCLUDE }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize), sort };
}

/** Live counts for worklist header cards and status tabs. */
export async function labWorklistCounts(tz, session, { mine } = {}) {
  const base = mine && session?.doctorId ? { doctorId: session.doctorId } : {};
  const [start, end] = dayRangeUtc(todayInTz(tz), tz);
  const [byStatus, urgentOpen, statOpen, releasedToday, orderedToday] = await Promise.all([
    prisma.labOrder.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    prisma.labOrder.count({ where: { ...base, status: { in: LAB_ACTIVE_STATUSES }, priority: { in: ["STAT", "URGENT"] } } }),
    prisma.labOrder.count({ where: { ...base, status: { in: LAB_ACTIVE_STATUSES }, priority: "STAT" } }),
    prisma.labOrder.count({ where: { ...base, status: "RELEASED", releasedAt: { gte: start, lt: end } } }),
    prisma.labOrder.count({ where: { ...base, createdAt: { gte: start, lt: end } } }),
  ]);
  const status = Object.fromEntries(LAB_STATUSES.map((s) => [s, 0]));
  for (const r of byStatus) status[r.status] = r._count._all;
  const active = LAB_ACTIVE_STATUSES.reduce((a, s) => a + status[s], 0);
  const all = Object.values(status).reduce((a, b) => a + b, 0);
  return { status, active, all, urgentOpen, statOpen, releasedToday, orderedToday };
}

// ═════════════════════════ Order detail ═════════════════════════

export async function getLabOrder(id) {
  const order = await prisma.labOrder.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true, phone: true, bloodGroup: true, medicalAlerts: true, status: true } },
      doctor: { include: { staff: { select: { firstName: true, lastName: true, userId: true } }, department: { select: { name: true } } } },
      encounter: { select: { id: true, encounterNo: true, status: true, startedAt: true, type: true } },
      items: { orderBy: { id: "asc" }, include: { test: true, results: { orderBy: { enteredAt: "desc" } } } },
      specimens: { orderBy: { collectedAt: "asc" } },
    },
  });
  if (!order) return null;
  const ids = new Set([order.releasedById]);
  for (const s of order.specimens) ids.add(s.collectedById);
  for (const it of order.items) for (const r of it.results) { ids.add(r.enteredById); ids.add(r.validatedById); }
  ids.delete(null); ids.delete(undefined);
  const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }) : [];
  order.userNames = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return order;
}

/**
 * Clinicians and other readers only ever see validated values. Laboratory staff
 * (process/validate) also see draft (unvalidated) results.
 */
export function redactLabOrder(order, session) {
  if (can(session, ["lab:process", "lab:validate"])) return order;
  return { ...order, items: order.items.map((it) => ({ ...it, results: it.results.filter((r) => r.validatedAt) })) };
}

export async function getLabOrderActivity(id) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "LabOrder", entityId: id, NOT: { action: { endsWith: ".view" } } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { user: { select: { name: true } } },
  });
  return rows;
}

// ═════════════════════════ Workflow ═════════════════════════

function assertTransition(from, to, message) {
  if (!canTransitionLab(from, to)) throw invalidState(message || `This order is ${statusLabel(from).toLowerCase()} and cannot move to "${statusLabel(to).toLowerCase()}".`);
}

/** Race-safe status change: only succeeds if the row is still in `from`. */
async function moveStatus(tx, id, from, to, data = {}) {
  assertTransition(from, to);
  const r = await tx.labOrder.updateMany({ where: { id, status: from }, data: { status: to, ...data } });
  if (r.count === 0) throw conflict("This order was updated by someone else. Refresh and try again.");
}

/** Row-lock the order in its current status for edits that don't change status. */
async function lockOrder(tx, id, status) {
  const r = await tx.labOrder.updateMany({ where: { id, status }, data: { updatedAt: new Date() } });
  if (r.count === 0) throw conflict("This order was updated by someone else. Refresh and try again.");
}

async function loadOrder(id, include = {}) {
  const order = await prisma.labOrder.findUnique({ where: { id }, include });
  if (!order) throw notFound("Lab order not found");
  return order;
}

const doctorUserInclude = { doctor: { select: { staff: { select: { userId: true } } } } };
const link = (id) => `/laboratory/${id}`;

export async function collectSpecimen(id, session, ip) {
  const order = await loadOrder(id, { items: { include: { test: { select: { specimenType: true } } } } });
  assertTransition(order.status, "SAMPLE_COLLECTED", order.status === "SAMPLE_COLLECTED" ? "The specimen has already been collected." : undefined);
  // One specimen per distinct specimen type required by the ordered tests.
  const types = [...new Set(order.items.map((i) => i.test.specimenType))];
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, order.status, "SAMPLE_COLLECTED");
    const specimens = [];
    for (const type of types) {
      specimens.push(await tx.specimen.create({ data: { orderId: id, specimenNo: await newId(tx, "specimen"), type, collectedById: session.user.id } }));
    }
    await audit({ userId: session.user.id, action: "lab.specimen.collect", entityType: "LabOrder", entityId: id, metadata: { orderNo: order.orderNo, specimenIds: specimens.map((s) => s.id), specimenNos: specimens.map((s) => s.specimenNo) }, ipAddress: ip }, tx);
    return { status: "SAMPLE_COLLECTED", specimens };
  });
}

export async function rejectSpecimen(id, { reason, recollect }, session, ip) {
  const order = await loadOrder(id, { specimens: true, items: { include: { results: { where: { isCurrent: true } } } }, ...doctorUserInclude });
  const to = recollect ? "REQUESTED" : "REJECTED";
  assertTransition(order.status, to, "A specimen can only be rejected after collection and before results are released.");
  const collected = order.specimens.filter((s) => s.status === "COLLECTED");
  if (!collected.length) throw invalidState("There is no collected specimen to reject.");
  if (order.items.some((it) => it.results.some((r) => r.validatedAt))) {
    throw invalidState("This order has validated results. Use a result correction instead of rejecting the specimen.");
  }
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, order.status, to, recollect ? {} : { cancelReason: reason });
    const sp = await tx.specimen.updateMany({ where: { id: { in: collected.map((s) => s.id) }, status: "COLLECTED" }, data: { status: "REJECTED", rejectionReason: reason } });
    // Draft results measured on the rejected specimen are retired (kept for traceability, never deleted).
    const discarded = await tx.labResult.updateMany({
      where: { orderItem: { orderId: id }, isCurrent: true, validatedAt: null },
      data: { isCurrent: false, correctionReason: "Discarded: specimen rejected" },
    });
    await audit({ userId: session.user.id, action: "lab.specimen.reject", entityType: "LabOrder", entityId: id, metadata: { orderNo: order.orderNo, specimenIds: collected.map((s) => s.id), rejected: sp.count, recollect, discardedResults: discarded.count, reason }, ipAddress: ip }, tx);
    await notifyUser(order.doctor?.staff?.userId, {
      category: "LAB",
      title: recollect ? "Lab specimen rejected: recollection needed" : "Lab order rejected",
      body: `Order ${order.orderNo}`,
      link: link(id),
    }, tx);
    if (recollect) await notifyPermission(["lab:process"], { category: "LAB", title: "Specimen recollection required", body: `Order ${order.orderNo}`, link: link(id) }, tx);
    return { status: to };
  });
}

export async function startProcessing(id, session, ip) {
  const order = await loadOrder(id, { specimens: { where: { status: "COLLECTED" }, select: { id: true } } });
  assertTransition(order.status, "PROCESSING", order.status === "REQUESTED" ? "Collect the specimen before starting processing." : undefined);
  if (!order.specimens.length) throw invalidState("There is no accepted specimen for this order.");
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, order.status, "PROCESSING");
    await audit({ userId: session.user.id, action: "lab.order.process", entityType: "LabOrder", entityId: id, metadata: { orderNo: order.orderNo }, ipAddress: ip }, tx);
    return { status: "PROCESSING" };
  });
}

/** Builds the stored result from raw input and the CONFIGURED test (unit, range, flag). */
function resultData(test, r) {
  const numeric = parseNumericValue(r.value);
  const unit = r.unit ?? test.unit ?? null;
  return {
    value: r.value,
    numericValue: numeric == null ? null : String(numeric),
    unit,
    referenceRange: formatReferenceRange(test),
    flag: flagForResult(test, r.value, unit),
    comment: r.comment ?? null,
  };
}

export async function enterResults(id, { results }, session, ip) {
  const order = await loadOrder(id, { items: { include: { test: true, results: { where: { isCurrent: true } } } } });
  if (!["PROCESSING", "AWAITING_VALIDATION"].includes(order.status)) {
    throw invalidState(order.status === "SAMPLE_COLLECTED" ? "Start processing before entering results." : "Results can only be entered while the order is processing or awaiting validation.");
  }
  const byId = new Map(order.items.map((i) => [i.id, i]));
  const seen = new Set();
  for (const r of results) {
    const item = byId.get(r.orderItemId);
    if (!item) throw badRequest("A result does not belong to this order.");
    if (seen.has(r.orderItemId)) throw badRequest("Each test can only have one result per submission.");
    seen.add(r.orderItemId);
    if (item.results[0]?.validatedAt) throw invalidState(`${item.test.name} has a validated result. Use "Correct result" to change it.`);
  }
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, id, order.status);
    let created = 0, updated = 0;
    const now = new Date();
    for (const r of results) {
      const item = byId.get(r.orderItemId);
      const data = resultData(item.test, r);
      const cur = item.results[0];
      if (cur) {
        // Unvalidated draft: edited in place (never seen outside the lab).
        const u = await tx.labResult.updateMany({ where: { id: cur.id, isCurrent: true, validatedAt: null }, data: { ...data, enteredById: session.user.id, enteredAt: now } });
        if (!u.count) throw conflict("A result was changed by someone else. Refresh and try again.");
        updated++;
      } else {
        await tx.labResult.create({ data: { ...data, orderItemId: item.id, enteredById: session.user.id, enteredAt: now } });
        created++;
      }
    }
    const missing = await tx.labOrderItem.count({ where: { orderId: id, results: { none: { isCurrent: true } } } });
    let status = order.status;
    if (missing === 0 && order.status === "PROCESSING") {
      await moveStatus(tx, id, "PROCESSING", "AWAITING_VALIDATION");
      status = "AWAITING_VALIDATION";
      await notifyPermission(["lab:validate"], { category: "LAB", title: "Lab results awaiting validation", body: `Order ${order.orderNo}`, link: link(id) }, tx);
    }
    await audit({ userId: session.user.id, action: "lab.result.enter", entityType: "LabOrder", entityId: id, metadata: { orderNo: order.orderNo, orderItemIds: results.map((r) => r.orderItemId), created, updated }, ipAddress: ip }, tx);
    return { status, missing, created, updated };
  });
}

export async function correctResult(id, input, session, ip) {
  const order = await loadOrder(id, { items: { include: { test: true, results: { where: { isCurrent: true } } } }, ...doctorUserInclude });
  if (!["RELEASED", "AWAITING_VALIDATION"].includes(order.status)) throw invalidState("Only validated results can be corrected.");
  const item = order.items.find((i) => i.id === input.orderItemId);
  if (!item) throw badRequest("The result does not belong to this order.");
  const cur = item.results[0];
  if (!cur) throw invalidState("There is no result to correct for this test.");
  if (!cur.validatedAt) throw invalidState("This result has not been validated yet. Edit it directly instead of correcting it.");
  return prisma.$transaction(async (tx) => {
    if (order.status === "RELEASED") await moveStatus(tx, id, "RELEASED", "AWAITING_VALIDATION");
    else await lockOrder(tx, id, "AWAITING_VALIDATION");
    const old = await tx.labResult.updateMany({ where: { id: cur.id, isCurrent: true }, data: { isCurrent: false, correctionReason: input.reason } });
    if (!old.count) throw conflict("The result was changed by someone else. Refresh and try again.");
    const nr = await tx.labResult.create({ data: { ...resultData(item.test, input), orderItemId: item.id, enteredById: session.user.id } });
    await audit({ userId: session.user.id, action: "lab.result.correct", entityType: "LabOrder", entityId: id, metadata: { orderNo: order.orderNo, orderItemId: item.id, testCode: item.test.code, previousResultId: cur.id, newResultId: nr.id, reason: input.reason, wasReleased: order.status === "RELEASED" }, ipAddress: ip }, tx);
    await notifyPermission(["lab:validate"], { category: "LAB", title: "Corrected lab result awaiting validation", body: `Order ${order.orderNo}`, link: link(id) }, tx);
    if (order.status === "RELEASED") {
      await notifyUser(order.doctor?.staff?.userId, { category: "LAB", title: "Released lab result under correction", body: `Order ${order.orderNo}: re-validation pending`, link: link(id) }, tx);
    }
    return { status: "AWAITING_VALIDATION", resultId: nr.id };
  });
}

export async function labValidationPolicy() {
  const cfg = await getSetting("lab");
  return { requireSecondValidator: cfg?.requireSecondValidator === true };
}

export async function validateAndRelease(id, session, ip) {
  const order = await loadOrder(id, {
    items: { include: { test: { select: { name: true } }, results: { where: { isCurrent: true } } } },
    patient: { select: { userLink: { select: { userId: true, verifiedAt: true } } } },
    ...doctorUserInclude,
  });
  assertTransition(order.status, "RELEASED", order.status === "RELEASED" ? "These results have already been released." : "Results can only be released when they are awaiting validation.");
  const missing = order.items.filter((it) => !it.results.length);
  if (missing.length) throw invalidState(`Enter results for all tests before release (missing: ${missing.map((m) => m.test.name).join(", ")}).`);
  const pending = order.items.flatMap((it) => it.results.filter((r) => !r.validatedAt));
  const { requireSecondValidator } = await labValidationPolicy();
  const selfEntered = pending.filter((r) => r.enteredById === session.user.id);
  if (requireSecondValidator && selfEntered.length) {
    throw forbidden("Second-person validation is required: results you entered must be validated by another authorised user.");
  }
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, "AWAITING_VALIDATION", "RELEASED", { releasedAt: now, releasedById: session.user.id });
    if (pending.length) {
      const v = await tx.labResult.updateMany({ where: { id: { in: pending.map((r) => r.id) }, isCurrent: true, validatedAt: null }, data: { validatedById: session.user.id, validatedAt: now } });
      if (v.count !== pending.length) throw conflict("Results changed while validating. Refresh and try again.");
    }
    const isCorrection = (await tx.labResult.count({ where: { orderItem: { orderId: id }, isCurrent: false, validatedAt: { not: null } } })) > 0;
    await audit({
      userId: session.user.id, action: "lab.order.release", entityType: "LabOrder", entityId: id,
      metadata: { orderNo: order.orderNo, resultIds: pending.map((r) => r.id), selfValidation: selfEntered.length > 0, selfValidatedResultIds: selfEntered.map((r) => r.id), requireSecondValidator, isCorrection },
      ipAddress: ip,
    }, tx);
    // Generic notifications only: never values or test names.
    await notifyUser(order.doctor?.staff?.userId, { category: "LAB", title: isCorrection ? "Corrected lab results available" : "New lab results available", body: `Order ${order.orderNo}`, link: link(id) }, tx);
    const portal = order.patient?.userLink;
    if (portal?.verifiedAt) {
      await notifyUser(portal.userId, { category: "LAB", title: "New lab results available", body: "Your laboratory results are ready to view.", link: "/portal/results" }, tx);
    }
    return { status: "RELEASED", releasedAt: now, selfValidation: selfEntered.length > 0 };
  });
}

export async function cancelLabOrder(id, { reason }, session, ip) {
  const order = await loadOrder(id, { ...doctorUserInclude });
  const isLab = can(session, "lab:process");
  if (!isLab && (!session.doctorId || order.doctorId !== session.doctorId)) {
    throw forbidden("Only the ordering doctor or laboratory staff can cancel this order.");
  }
  assertTransition(order.status, "CANCELLED", "Orders can only be cancelled before processing starts.");
  return prisma.$transaction(async (tx) => {
    await moveStatus(tx, id, order.status, "CANCELLED", { cancelReason: reason });
    await audit({ userId: session.user.id, action: "lab.order.cancel", entityType: "LabOrder", entityId: id, metadata: { orderNo: order.orderNo, from: order.status, reason }, ipAddress: ip }, tx);
    if (isLab) {
      if (order.doctor?.staff?.userId !== session.user.id) await notifyUser(order.doctor?.staff?.userId, { category: "LAB", title: "Lab order cancelled", body: `Order ${order.orderNo}`, link: link(id) }, tx);
    } else {
      await notifyPermission(["lab:process"], { category: "LAB", title: "Lab order cancelled by clinician", body: `Order ${order.orderNo}`, link: link(id) }, tx);
    }
    return { status: "CANCELLED" };
  });
}
