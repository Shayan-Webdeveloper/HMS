import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";
import { ApiError, conflict, notFound, invalidState } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { getHospital, getSetting } from "@/lib/services/settings";
import { notifyPermission } from "@/lib/services/notifications";
import { patientSearchWhere } from "@/lib/services/patients";
import { dayRangeUtc, todayInTz, addDays } from "@/lib/utils/time";
import { toMoneyString } from "@/lib/utils/money";
import {
  allocateFefo, computePrescriptionStatus, classifyExpiry, isBatchUsable, toDateKey, netDispensedByBatch,
  DISPENSABLE_STATUSES, RETURNABLE_STATUSES, QUEUE_STATUSES, humanize,
} from "@/lib/validation/pharmacy";

// ───────────────────────────── Helpers ─────────────────────────────

const fieldError = (field, message) => new ApiError(422, "VALIDATION_ERROR", message, { [field]: message });
const ci = (v) => ({ contains: v, mode: "insensitive" });
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const medName = (m) => `${m.genericName} ${m.strength}`;

/** Time-zone aware "today" and the expiry alert window used by every stock calculation. */
export async function pharmacyContext() {
  const h = await getHospital();
  const cfg = await getSetting("pharmacy");
  const alertDays = Math.max(0, Number(cfg?.expiryAlertDays ?? 90) || 0);
  const today = todayInTz(h.timezone);
  return { tz: h.timezone, currency: h.currency, today, alertDays, alertUntil: addDays(today, alertDays) };
}

/** Usable (non-expired) on-hand per medication id. */
export async function onHandByMedication(medicationIds, today, db = prisma) {
  const ids = [...new Set(medicationIds)].filter(Boolean);
  const out = new Map(ids.map((i) => [i, 0]));
  if (!ids.length) return out;
  const rows = await db.medicationBatch.groupBy({
    by: ["medicationId"],
    where: { medicationId: { in: ids }, expiryDate: { gt: new Date(today) } },
    _sum: { quantity: true },
  });
  for (const r of rows) out.set(r.medicationId, r._sum.quantity ?? 0);
  return out;
}

async function userNames(ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

// ───────────────────────────── Stock aggregation (SQL) ─────────────────────────────

function medicationWhereSql({ q, category, activeOrStocked, activeOnly }) {
  const conds = [];
  if (q) {
    const pat = `%${escapeLike(q)}%`;
    conds.push(Prisma.sql`(m.code ILIKE ${pat} OR m."genericName" ILIKE ${pat} OR m."brandName" ILIKE ${pat})`);
  }
  if (category) conds.push(Prisma.sql`m.category = ${category}`);
  if (activeOnly) conds.push(Prisma.sql`m."isActive" = true`);
  if (activeOrStocked) conds.push(Prisma.sql`(m."isActive" = true OR EXISTS (SELECT 1 FROM "MedicationBatch" x WHERE x."medicationId" = m.id AND x.quantity > 0))`);
  return conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;
}

function stockCte(whereSql, today, alertUntil) {
  return Prisma.sql`
    SELECT m.id, m.code, m."genericName", m."brandName", m.strength, m."dosageForm", m.category, m.unit,
           m."sellingPrice"::text AS "sellingPrice", m."reorderLevel", m."isActive",
           COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" > ${today}::date), 0)::int AS "onHand",
           COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" <= ${today}::date), 0)::int AS "expiredQty",
           COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" > ${today}::date AND b."expiryDate" <= ${alertUntil}::date), 0)::int AS "expiringQty",
           MIN(b."expiryDate") FILTER (WHERE b."expiryDate" > ${today}::date AND b.quantity > 0) AS "nextExpiry",
           COUNT(b.id) FILTER (WHERE b.quantity > 0)::int AS "batchCount"
    FROM "Medication" m
    LEFT JOIN "MedicationBatch" b ON b."medicationId" = m.id
    ${whereSql}
    GROUP BY m.id`;
}

const STOCK_FILTER_SQL = {
  low: Prisma.sql`s."isActive" = true AND s."onHand" <= s."reorderLevel"`,
  out: Prisma.sql`s."isActive" = true AND s."onHand" = 0`,
  expiring: Prisma.sql`s."expiringQty" > 0`,
  expired: Prisma.sql`s."expiredQty" > 0`,
};

const STOCK_SORT = {
  name: (d) => `s."genericName" ${d}, s.strength ${d}`,
  code: (d) => `s.code ${d}`,
  onHand: (d) => `s."onHand" ${d}, s."genericName" ASC`,
  reorderLevel: (d) => `s."reorderLevel" ${d}, s."genericName" ASC`,
  nextExpiry: (d) => `s."nextExpiry" ${d} NULLS LAST, s."genericName" ASC`,
};

/**
 * Stock overview: one row per medication with usable on-hand (non-expired batches),
 * expired quantity still on the shelf and quantity expiring within the alert window.
 */
export async function listStock({ q, page, pageSize, sort, dir, status, category }, ctx) {
  const whereSql = medicationWhereSql({ q, category, activeOrStocked: true });
  const cte = stockCte(whereSql, ctx.today, ctx.alertUntil);
  const outer = STOCK_FILTER_SQL[status] ? Prisma.sql`WHERE ${STOCK_FILTER_SQL[status]}` : Prisma.empty;
  const d = dir === "desc" ? "DESC" : "ASC";
  const order = Prisma.raw((STOCK_SORT[sort] || STOCK_SORT.name)(d));
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw`WITH s AS (${cte}) SELECT * FROM s ${outer} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw`WITH s AS (${cte}) SELECT COUNT(*)::int AS count FROM s ${outer}`,
  ]);
  return { rows, meta: pageMeta(countRows[0]?.count ?? 0, page, pageSize) };
}

/** Real counts for the pharmacy header cards. */
export async function pharmacySummary(ctx) {
  const cte = stockCte(medicationWhereSql({ activeOnly: true }), ctx.today, ctx.alertUntil);
  const [[meds], [batches], queue] = await Promise.all([
    prisma.$queryRaw`WITH s AS (${cte}) SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE s."onHand" <= s."reorderLevel")::int AS low,
      COUNT(*) FILTER (WHERE s."onHand" = 0)::int AS out FROM s`,
    prisma.$queryRaw`SELECT
      COUNT(*) FILTER (WHERE "expiryDate" <= ${ctx.today}::date AND quantity > 0)::int AS expired,
      COUNT(*) FILTER (WHERE "expiryDate" > ${ctx.today}::date AND "expiryDate" <= ${ctx.alertUntil}::date AND quantity > 0)::int AS expiring
      FROM "MedicationBatch"`,
    prisma.prescription.count({ where: { status: { in: DISPENSABLE_STATUSES } } }),
  ]);
  return { totalMedications: meds.total, low: meds.low, out: meds.out, expiredBatches: batches.expired, expiringBatches: batches.expiring, queue };
}

/** Cross-module contract: GET /api/pharmacy/medications?q= */
export async function lookupMedications({ q, pageSize, includeInactive }, ctx) {
  const whereSql = medicationWhereSql({ q, activeOnly: !includeInactive });
  const cte = stockCte(whereSql, ctx.today, ctx.alertUntil);
  const rows = await prisma.$queryRaw`WITH s AS (${cte}) SELECT * FROM s ORDER BY s."genericName" ASC, s.strength ASC LIMIT ${pageSize}`;
  return rows.map((r) => ({
    id: r.id, code: r.code, genericName: r.genericName, brandName: r.brandName, strength: r.strength,
    dosageForm: r.dosageForm, sellingPrice: r.sellingPrice, onHand: r.onHand,
  }));
}

export async function medicationCategories() {
  const rows = await prisma.medication.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return rows.map((r) => r.category);
}

// ───────────────────────────── Catalogue ─────────────────────────────

const CATALOGUE_SORT = { code: ["code"], name: ["genericName", "strength"], price: ["sellingPrice"], reorderLevel: ["reorderLevel"], createdAt: ["createdAt"] };

export async function listCatalogue({ q, page, pageSize, sort, dir, status, form }) {
  const where = {};
  if (q) where.OR = [{ code: ci(q) }, { genericName: ci(q) }, { brandName: ci(q) }, { manufacturer: ci(q) }, { category: ci(q) }];
  if (status === "ACTIVE") where.isActive = true;
  else if (status === "INACTIVE") where.isActive = false;
  if (form) where.dosageForm = form;
  const orderBy = (CATALOGUE_SORT[sort] || CATALOGUE_SORT.name).map((f) => ({ [f]: dir }));
  const [total, rows] = await Promise.all([
    prisma.medication.count({ where }),
    prisma.medication.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

function medicationData(input) {
  return {
    code: input.code, genericName: input.genericName, brandName: input.brandName ?? null, strength: input.strength,
    dosageForm: input.dosageForm, category: input.category ?? null, manufacturer: input.manufacturer ?? null,
    unit: input.unit, sellingPrice: toMoneyString(input.sellingPrice), reorderLevel: input.reorderLevel, isActive: true,
  };
}

export async function createMedication(input, session, ip) {
  const dup = await prisma.medication.findUnique({ where: { code: input.code }, select: { id: true } });
  if (dup) throw conflict("A medication with this code already exists.", { code: "Code already in use" });
  return prisma.$transaction(async (tx) => {
    const m = await tx.medication.create({ data: medicationData(input) });
    await audit({ userId: session.user.id, action: "medication.create", entityType: "Medication", entityId: m.id, metadata: { code: m.code }, ipAddress: ip }, tx);
    return m;
  });
}

export async function updateMedication(id, input, session, ip) {
  const existing = await prisma.medication.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (input.code !== existing.code) {
    const dup = await prisma.medication.findUnique({ where: { code: input.code }, select: { id: true } });
    if (dup) throw conflict("A medication with this code already exists.", { code: "Code already in use" });
  }
  // Activation is only changed through setMedicationActive (separately audited).
  const data = { ...medicationData(input), isActive: existing.isActive };
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  return prisma.$transaction(async (tx) => {
    const m = await tx.medication.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: "medication.update", entityType: "Medication", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return m;
  });
}

export async function setMedicationActive(id, isActive, reason, session, ip) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.medication.updateMany({ where: { id, isActive: !isActive }, data: { isActive } });
    if (!r.count) {
      const exists = await tx.medication.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound();
      throw invalidState(isActive ? "Medication is already active." : "Medication is already inactive.");
    }
    await audit({ userId: session.user.id, action: isActive ? "medication.activate" : "medication.deactivate", entityType: "Medication", entityId: id, metadata: reason ? { reason } : undefined, ipAddress: ip }, tx);
    return { id, isActive };
  });
}

/** Medication with all batches (FEFO order) and computed totals. */
export async function getMedication(id, ctx) {
  const m = await prisma.medication.findUnique({
    where: { id },
    include: { batches: { orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }], include: { supplier: { select: { id: true, name: true } } } } },
  });
  if (!m) return null;
  let onHand = 0, expiredQty = 0, expiringQty = 0, nextExpiry = null;
  const batches = m.batches.map((b) => {
    const expiry = classifyExpiry(b.expiryDate, ctx.today, ctx.alertDays);
    if (expiry === "EXPIRED") expiredQty += b.quantity;
    else {
      onHand += b.quantity;
      if (expiry === "EXPIRING") expiringQty += b.quantity;
      if (b.quantity > 0 && !nextExpiry) nextExpiry = b.expiryDate;
    }
    return { ...b, expiry };
  });
  return { ...m, batches, onHand, expiredQty, expiringQty, nextExpiry };
}

// ───────────────────────────── Receiving & adjustments ─────────────────────────────

export async function receiveBatch(medicationId, input, session, ip) {
  const { today } = await pharmacyContext();
  if (input.expiryDate <= today) throw fieldError("expiryDate", "Expiry date must be in the future");
  const med = await prisma.medication.findUnique({ where: { id: medicationId }, select: { id: true, isActive: true, code: true } });
  if (!med) throw notFound("Medication not found");
  if (!med.isActive) throw invalidState("This medication is inactive. Reactivate it in the catalogue before receiving stock.");
  if (input.supplierId) {
    const s = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { isActive: true } });
    if (!s || !s.isActive) throw fieldError("supplierId", "Choose an active supplier");
  }
  const dup = await prisma.medicationBatch.findUnique({ where: { medicationId_batchNo: { medicationId, batchNo: input.batchNo } }, select: { id: true } });
  if (dup) throw conflict("This batch number already exists for this medication.", { batchNo: "Batch number already exists for this medication" });
  return prisma.$transaction(async (tx) => {
    const b = await tx.medicationBatch.create({
      data: { medicationId, batchNo: input.batchNo, expiryDate: new Date(input.expiryDate), quantity: input.quantity, purchaseCost: toMoneyString(input.purchaseCost), supplierId: input.supplierId ?? null },
    });
    await tx.stockMovement.create({
      data: { type: "RECEIPT", medicationId, batchId: b.id, quantity: input.quantity, balanceAfter: input.quantity, reason: "Stock received", referenceType: "MedicationBatch", referenceId: b.id, performedById: session.user.id },
    });
    await audit({ userId: session.user.id, action: "pharmacy.receive", entityType: "MedicationBatch", entityId: b.id, metadata: { medicationId, batchNo: b.batchNo, quantity: input.quantity, supplierId: input.supplierId ?? null }, ipAddress: ip }, tx);
    return b;
  });
}

/** +/- correction on one batch. Decrements are conditional so stock can never go negative. */
export async function adjustBatch(batchId, { direction, quantity, reason }, session, ip) {
  const batch = await prisma.medicationBatch.findUnique({ where: { id: batchId }, select: { id: true, medicationId: true, batchNo: true } });
  if (!batch) throw notFound("Batch not found");
  return prisma.$transaction(async (tx) => {
    if (direction === "OUT") {
      const r = await tx.medicationBatch.updateMany({ where: { id: batchId, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } });
      if (!r.count) throw invalidState(`Insufficient stock in batch ${batch.batchNo} to remove ${quantity}.`);
    } else {
      await tx.medicationBatch.update({ where: { id: batchId }, data: { quantity: { increment: quantity } } });
    }
    const after = await tx.medicationBatch.findUnique({ where: { id: batchId }, select: { quantity: true } });
    const signed = direction === "OUT" ? -quantity : quantity;
    await tx.stockMovement.create({
      data: { type: "ADJUSTMENT", medicationId: batch.medicationId, batchId, quantity: signed, balanceAfter: after.quantity, reason, performedById: session.user.id },
    });
    await audit({ userId: session.user.id, action: "pharmacy.adjust", entityType: "MedicationBatch", entityId: batchId, metadata: { quantity: signed, reason }, ipAddress: ip }, tx);
    return { batchId, quantity: after.quantity };
  });
}

/** Remove expired stock from a batch (EXPIRED movement). Only batches past expiry qualify. */
export async function writeOffBatch(batchId, { quantity, reason }, session, ip) {
  const { today } = await pharmacyContext();
  const batch = await prisma.medicationBatch.findUnique({ where: { id: batchId }, select: { id: true, medicationId: true, batchNo: true, expiryDate: true, quantity: true } });
  if (!batch) throw notFound("Batch not found");
  if (isBatchUsable(batch.expiryDate, today)) throw invalidState("Only expired batches can be written off. Use an adjustment for damaged or lost stock.");
  const qty = quantity ?? batch.quantity;
  if (qty <= 0) throw invalidState("Nothing to write off — this batch is already empty.");
  if (qty > batch.quantity) throw fieldError("quantity", `Only ${batch.quantity} on hand in this batch`);
  return prisma.$transaction(async (tx) => {
    const r = await tx.medicationBatch.updateMany({ where: { id: batchId, quantity: { gte: qty } }, data: { quantity: { decrement: qty } } });
    if (!r.count) throw invalidState("Stock in this batch changed. Refresh and try again.");
    const after = await tx.medicationBatch.findUnique({ where: { id: batchId }, select: { quantity: true } });
    await tx.stockMovement.create({
      data: { type: "EXPIRED", medicationId: batch.medicationId, batchId, quantity: -qty, balanceAfter: after.quantity, reason, performedById: session.user.id },
    });
    await audit({ userId: session.user.id, action: "pharmacy.writeoff", entityType: "MedicationBatch", entityId: batchId, metadata: { quantity: qty, reason, expiryDate: toDateKey(batch.expiryDate) }, ipAddress: ip }, tx);
    return { batchId, quantity: after.quantity };
  });
}

// ───────────────────────────── Prescriptions queue ─────────────────────────────

const RX_SORT = { createdAt: ["createdAt"], prescriptionNo: ["prescriptionNo"] };

export async function listPrescriptionQueue({ q, page, pageSize, sort, dir, status, from, to }, tz) {
  const where = {};
  if (status === "ALL") where.status = { in: QUEUE_STATUSES };
  else if (QUEUE_STATUSES.includes(status)) where.status = status;
  else where.status = { in: DISPENSABLE_STATUSES };
  if (q) where.OR = [{ prescriptionNo: ci(q) }, { patient: patientSearchWhere(q) }];
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.createdAt.lt = dayRangeUtc(to, tz)[1];
  }
  const orderBy = (RX_SORT[sort] || RX_SORT.createdAt).map((f) => ({ [f]: dir }));
  const [total, rows] = await Promise.all([
    prisma.prescription.count({ where }),
    prisma.prescription.findMany({
      where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, prescriptionNo: true, status: true, createdAt: true, issuedAt: true,
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        doctor: { select: { staff: { select: { firstName: true, lastName: true } } } },
        items: { select: { quantity: true, dispensedQty: true } },
      },
    }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

/** Everything the dispensing screen needs: patient banner (with active allergies), items, stock and history. */
export async function getPrescriptionForDispensing(id, ctx) {
  const rx = await prisma.prescription.findUnique({
    where: { id },
    include: {
      patient: {
        select: {
          id: true, mrn: true, firstName: true, lastName: true, dateOfBirth: true, sex: true, phone: true, medicalAlerts: true, status: true,
          allergies: { where: { isActive: true }, orderBy: { createdAt: "desc" }, select: { id: true, substance: true, reaction: true, severity: true } },
        },
      },
      doctor: { select: { id: true, specialty: true, staff: { select: { firstName: true, lastName: true } }, department: { select: { name: true } } } },
      encounter: { select: { id: true, encounterNo: true } },
      items: { orderBy: { id: "asc" }, include: { medication: true } },
    },
  });
  if (!rx) return null;
  const itemIds = rx.items.map((i) => i.id);
  const [stock, movements] = await Promise.all([
    onHandByMedication(rx.items.map((i) => i.medicationId), ctx.today),
    itemIds.length
      ? prisma.stockMovement.findMany({
        where: { referenceType: "PrescriptionItem", referenceId: { in: itemIds } },
        orderBy: { createdAt: "asc" },
        include: { batch: { select: { id: true, batchNo: true, expiryDate: true } } },
      })
      : [],
  ]);
  const names = await userNames(movements.map((m) => m.performedById));
  const byItem = new Map(itemIds.map((i) => [i, []]));
  for (const mv of movements) byItem.get(mv.referenceId)?.push(mv);

  // Batches eligible for a return: those that were dispensed for the item (net > 0).
  // Legacy rows dispensed before the ledger existed fall back to any batch of the medication.
  const legacyMedIds = rx.items.filter((i) => i.dispensedQty > 0 && !(byItem.get(i.id) || []).some((m) => m.type === "DISPENSE")).map((i) => i.medicationId);
  const legacyBatches = legacyMedIds.length
    ? await prisma.medicationBatch.findMany({ where: { medicationId: { in: legacyMedIds } }, orderBy: { expiryDate: "asc" }, select: { id: true, medicationId: true, batchNo: true, expiryDate: true } })
    : [];

  const items = rx.items.map((it) => {
    const mvs = byItem.get(it.id) || [];
    const net = netDispensedByBatch(mvs);
    let returnBatches;
    if (mvs.some((m) => m.type === "DISPENSE")) {
      const info = new Map(mvs.filter((m) => m.batch).map((m) => [m.batchId, m.batch]));
      returnBatches = [...net.entries()].filter(([, n]) => n > 0).map(([batchId, n]) => ({ id: batchId, batchNo: info.get(batchId)?.batchNo, expiryDate: info.get(batchId)?.expiryDate, max: Math.min(n, it.dispensedQty) }));
    } else {
      returnBatches = legacyBatches.filter((b) => b.medicationId === it.medicationId).map((b) => ({ id: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, max: it.dispensedQty }));
    }
    return { ...it, remaining: it.quantity - it.dispensedQty, onHand: stock.get(it.medicationId) ?? 0, returnBatches };
  });
  const history = movements.map((m) => ({ ...m, performedByName: names.get(m.performedById) || "—", item: rx.items.find((i) => i.id === m.referenceId) }));
  return { ...rx, items, history };
}

// ───────────────────────────── Dispensing ─────────────────────────────

/**
 * Dispense quantities against a prescription. Allocation is FEFO across non-expired batches and
 * the whole call runs in one transaction — any shortfall rolls everything back.
 */
export async function dispensePrescription(id, input, session, ip) {
  const { today } = await pharmacyContext();
  const todayDate = new Date(today);
  const requested = input.items.map((r, idx) => ({ ...r, idx })).filter((r) => r.quantity > 0);
  if (!requested.length) throw invalidState("Enter a quantity to dispense for at least one item.");

  const result = await prisma.$transaction(async (tx) => {
    // Row lock + state check in one statement (race-safe): concurrent dispenses serialise here.
    const lock = await tx.prescription.updateMany({ where: { id, status: { in: DISPENSABLE_STATUSES } }, data: { updatedAt: new Date() } });
    if (!lock.count) {
      const exists = await tx.prescription.findUnique({ where: { id }, select: { status: true } });
      if (!exists) throw notFound("Prescription not found");
      throw invalidState(`This prescription is ${humanize(exists.status).toLowerCase()} and cannot be dispensed.`);
    }
    const rx = await tx.prescription.findUnique({
      where: { id },
      select: { id: true, prescriptionNo: true, items: { select: { id: true, medicationId: true, quantity: true, dispensedQty: true, medication: { select: { id: true, genericName: true, strength: true, reorderLevel: true } } } } },
    });
    const byId = new Map(rx.items.map((i) => [i.id, i]));
    for (const r of requested) {
      const it = byId.get(r.itemId);
      if (!it) throw fieldError(`items.${r.idx}.quantity`, "This item does not belong to the prescription");
      const remaining = it.quantity - it.dispensedQty;
      if (r.quantity > remaining) throw fieldError(`items.${r.idx}.quantity`, remaining === 0 ? "Already fully dispensed" : `Only ${remaining} remaining`);
    }

    // Plan FEFO allocations against a working copy of the non-expired batches.
    const medIds = [...new Set(requested.map((r) => byId.get(r.itemId).medicationId))];
    const batches = await tx.medicationBatch.findMany({
      where: { medicationId: { in: medIds }, quantity: { gt: 0 }, expiryDate: { gt: todayDate } },
      select: { id: true, medicationId: true, batchNo: true, expiryDate: true, quantity: true, receivedAt: true },
    });
    const pool = new Map(medIds.map((m) => [m, batches.filter((b) => b.medicationId === m).map((b) => ({ ...b }))]));
    const plan = [];
    for (const r of requested) {
      const it = byId.get(r.itemId);
      const list = pool.get(it.medicationId);
      const alloc = allocateFefo(list, r.quantity, today);
      if (!alloc.ok) {
        throw invalidState(`Insufficient stock for ${medName(it.medication)}: ${alloc.available} available in non-expired batches, ${r.quantity} requested.`);
      }
      for (const a of alloc.allocations) list.find((b) => b.id === a.batchId).quantity -= a.quantity;
      plan.push({ item: it, quantity: r.quantity, allocations: alloc.allocations });
    }

    // Execute decrements in a global order (batch id) so concurrent dispenses cannot deadlock.
    const steps = plan.flatMap((p) => p.allocations.map((a) => ({ ...a, item: p.item }))).sort((a, b) => (a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0));
    for (const s of steps) {
      const u = await tx.medicationBatch.updateMany({
        where: { id: s.batchId, quantity: { gte: s.quantity }, expiryDate: { gt: todayDate } },
        data: { quantity: { decrement: s.quantity } },
      });
      if (!u.count) throw invalidState(`Insufficient stock for ${medName(s.item.medication)}: stock changed while dispensing. Refresh and try again.`);
      const b = await tx.medicationBatch.findUnique({ where: { id: s.batchId }, select: { quantity: true } });
      await tx.stockMovement.create({
        data: {
          type: "DISPENSE", medicationId: s.item.medicationId, batchId: s.batchId, quantity: -s.quantity, balanceAfter: b.quantity,
          reason: `Dispensed against ${rx.prescriptionNo}`, referenceType: "PrescriptionItem", referenceId: s.item.id, performedById: session.user.id,
        },
      });
    }
    for (const p of plan) {
      const u = await tx.prescriptionItem.updateMany({
        where: { id: p.item.id, prescriptionId: id, dispensedQty: { lte: p.item.quantity - p.quantity } },
        data: { dispensedQty: { increment: p.quantity } },
      });
      if (!u.count) throw invalidState("The quantity exceeds what remains on this prescription. Refresh and try again.");
    }

    const items = await tx.prescriptionItem.findMany({ where: { prescriptionId: id }, select: { quantity: true, dispensedQty: true } });
    const status = computePrescriptionStatus(items);
    await tx.prescription.update({ where: { id }, data: { status } });
    await audit({
      userId: session.user.id, action: "prescription.dispense", entityType: "Prescription", entityId: id,
      metadata: { prescriptionNo: rx.prescriptionNo, status, items: plan.map((p) => ({ itemId: p.item.id, quantity: p.quantity, batches: p.allocations })) },
      ipAddress: ip,
    }, tx);

    const onHand = await onHandByMedication(medIds, today, tx);
    const meds = [...new Map(plan.map((p) => [p.item.medicationId, p.item.medication])).values()];
    const low = meds.filter((m) => (onHand.get(m.id) ?? 0) <= m.reorderLevel);
    return { status, dispensed: plan.reduce((s, p) => s + p.quantity, 0), low };
  }, { timeout: 20000 });

  if (result.low.length) {
    // Once per dispensing call; medicine names only — never patient details.
    const names = result.low.slice(0, 3).map(medName).join(", ") + (result.low.length > 3 ? ` and ${result.low.length - 3} more` : "");
    try {
      await notifyPermission(["pharmacy:manage"], { category: "PHARMACY", title: "Low stock alert", body: `${names} ${result.low.length === 1 ? "is" : "are"} at or below reorder level after dispensing.`, link: "/pharmacy?tab=stock&status=low" });
    } catch (e) {
      console.error("[pharmacy] low-stock notification failed", e?.code ?? "", String(e?.message || "").slice(0, 200));
    }
  }
  return { id, status: result.status, dispensed: result.dispensed, lowStock: result.low.map((m) => m.id) };
}

/** Return part of a dispensed item to a specific batch (RETURN movement). */
export async function returnPrescriptionItem(id, { itemId, batchId, quantity, reason }, session, ip) {
  return prisma.$transaction(async (tx) => {
    const lock = await tx.prescription.updateMany({ where: { id, status: { in: RETURNABLE_STATUSES } }, data: { updatedAt: new Date() } });
    if (!lock.count) {
      const exists = await tx.prescription.findUnique({ where: { id }, select: { status: true } });
      if (!exists) throw notFound("Prescription not found");
      throw invalidState("Returns are only possible on dispensed or partially dispensed prescriptions.");
    }
    const item = await tx.prescriptionItem.findFirst({ where: { id: itemId, prescriptionId: id }, select: { id: true, medicationId: true, dispensedQty: true, prescription: { select: { prescriptionNo: true } } } });
    if (!item) throw notFound("Prescription item not found");
    if (item.dispensedQty <= 0) throw invalidState("Nothing has been dispensed for this item.");
    if (quantity > item.dispensedQty) throw fieldError("quantity", `At most ${item.dispensedQty} can be returned`);
    const batch = await tx.medicationBatch.findFirst({ where: { id: batchId, medicationId: item.medicationId }, select: { id: true, batchNo: true } });
    if (!batch) throw fieldError("batchId", "Choose a batch of this medication");
    const hist = await tx.stockMovement.findMany({ where: { referenceType: "PrescriptionItem", referenceId: item.id, type: { in: ["DISPENSE", "RETURN"] } }, select: { type: true, batchId: true, quantity: true } });
    if (hist.some((h) => h.type === "DISPENSE")) {
      const net = netDispensedByBatch(hist).get(batch.id) ?? 0;
      if (net <= 0) throw fieldError("batchId", "This batch was not used for this item");
      if (quantity > net) throw fieldError("quantity", `Only ${net} were dispensed from batch ${batch.batchNo}`);
    }
    const u = await tx.prescriptionItem.updateMany({ where: { id: item.id, dispensedQty: { gte: quantity } }, data: { dispensedQty: { decrement: quantity } } });
    if (!u.count) throw invalidState("Dispensed quantity changed. Refresh and try again.");
    await tx.medicationBatch.update({ where: { id: batch.id }, data: { quantity: { increment: quantity } } });
    const after = await tx.medicationBatch.findUnique({ where: { id: batch.id }, select: { quantity: true } });
    await tx.stockMovement.create({
      data: { type: "RETURN", medicationId: item.medicationId, batchId: batch.id, quantity, balanceAfter: after.quantity, reason, referenceType: "PrescriptionItem", referenceId: item.id, performedById: session.user.id },
    });
    const items = await tx.prescriptionItem.findMany({ where: { prescriptionId: id }, select: { quantity: true, dispensedQty: true } });
    const status = computePrescriptionStatus(items);
    await tx.prescription.update({ where: { id }, data: { status } });
    await audit({ userId: session.user.id, action: "prescription.return", entityType: "Prescription", entityId: id, metadata: { prescriptionNo: item.prescription.prescriptionNo, itemId, batchId, quantity, reason, status }, ipAddress: ip }, tx);
    return { id, status };
  });
}

// ───────────────────────────── Ledger ─────────────────────────────

export async function listMedicationLedger({ q, page, pageSize, dir, medicationId, type, from, to }, tz) {
  const where = { medicationId: medicationId || { not: null } };
  if (type) where.type = type;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.createdAt.lt = dayRangeUtc(to, tz)[1];
  }
  if (q) where.OR = [{ batch: { batchNo: ci(q) } }, { reason: ci(q) }, { medication: { OR: [{ genericName: ci(q) }, { code: ci(q) }, { brandName: ci(q) }] } }];
  const [total, rows] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where, orderBy: [{ createdAt: dir === "asc" ? "asc" : "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
      include: { medication: { select: { id: true, code: true, genericName: true, strength: true, unit: true } }, batch: { select: { id: true, batchNo: true, expiryDate: true } } },
    }),
  ]);
  const names = await userNames(rows.map((r) => r.performedById));
  const itemIds = rows.filter((r) => r.referenceType === "PrescriptionItem" && r.referenceId).map((r) => r.referenceId);
  const refs = itemIds.length
    ? await prisma.prescriptionItem.findMany({ where: { id: { in: [...new Set(itemIds)] } }, select: { id: true, prescription: { select: { id: true, prescriptionNo: true } } } })
    : [];
  const refMap = new Map(refs.map((r) => [r.id, r.prescription]));
  return {
    rows: rows.map((r) => ({ ...r, performedByName: names.get(r.performedById) || "—", prescription: r.referenceType === "PrescriptionItem" ? refMap.get(r.referenceId) ?? null : null })),
    meta: pageMeta(total, page, pageSize),
  };
}

export async function medicationOptions() {
  return prisma.medication.findMany({ orderBy: [{ genericName: "asc" }, { strength: "asc" }], take: 500, select: { id: true, code: true, genericName: true, strength: true, isActive: true } });
}

export async function activeSupplierOptions() {
  return prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } });
}
