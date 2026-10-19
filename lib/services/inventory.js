import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { ApiError, conflict, notFound, invalidState } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { notifyPermission } from "@/lib/services/notifications";
import { dayRangeUtc } from "@/lib/utils/time";
import { D, toMoneyString } from "@/lib/utils/money";
import { calcPoTotal, calcStockValue, canTransitionPo, humanize } from "@/lib/validation/inventory";

const fieldError = (field, message) => new ApiError(422, "VALIDATION_ERROR", message, { [field]: message });
const ci = (v) => ({ contains: v, mode: "insensitive" });

function dateWhere(field, from, to, tz) {
  if (!from && !to) return {};
  const w = {};
  if (from) w.gte = dayRangeUtc(from, tz)[0];
  if (to) w.lt = dayRangeUtc(to, tz)[1];
  return { [field]: w };
}

async function userNames(ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

// ───────────────────────────── Items ─────────────────────────────

function itemWhere({ q, status, stock, category }) {
  const where = {};
  if (q) where.OR = [{ code: ci(q) }, { name: ci(q) }, { location: ci(q) }];
  if (category) where.category = category;
  if (status === "ACTIVE") where.isActive = true;
  else if (status === "INACTIVE") where.isActive = false;
  // Column-to-column comparison via Prisma field references.
  if (stock === "low") where.quantity = { lte: prisma.inventoryItem.fields.reorderLevel };
  if (stock === "out") where.quantity = 0;
  return where;
}

const ITEM_SORT = { code: ["code"], name: ["name"], quantity: ["quantity"], unitCost: ["unitCost"], createdAt: ["createdAt"] };

export async function listItems(params) {
  const { page, pageSize, sort, dir } = params;
  const where = itemWhere(params);
  const orderBy = (ITEM_SORT[sort] || ITEM_SORT.name).map((f) => ({ [f]: dir }));
  const [total, rows, all] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    // Valuation of the whole filtered set (not just this page) with Decimal math.
    prisma.inventoryItem.findMany({ where, select: { quantity: true, unitCost: true } }),
  ]);
  const totals = { items: total, units: all.reduce((s, r) => s + r.quantity, 0), value: calcStockValue(all) };
  return { rows: rows.map((r) => ({ ...r, value: toMoneyString(D(r.unitCost).mul(r.quantity)) })), meta: pageMeta(total, page, pageSize), totals };
}

export async function inventorySummary() {
  const [active, low, out, valueRows, openPos] = await Promise.all([
    prisma.inventoryItem.count({ where: { isActive: true } }),
    prisma.inventoryItem.count({ where: { isActive: true, quantity: { lte: prisma.inventoryItem.fields.reorderLevel } } }),
    prisma.inventoryItem.count({ where: { isActive: true, quantity: 0 } }),
    prisma.$queryRaw`SELECT COALESCE(SUM(quantity * "unitCost"), 0)::text AS value FROM "InventoryItem" WHERE "isActive" = true`,
    prisma.purchaseOrder.aggregate({ where: { status: { in: ["DRAFT", "ORDERED"] } }, _count: true, _sum: { total: true } }),
  ]);
  return { active, low, out, stockValue: toMoneyString(valueRows[0]?.value ?? 0), openPoCount: openPos._count, openPoValue: toMoneyString(openPos._sum.total ?? 0) };
}

function itemData(input) {
  return {
    code: input.code, name: input.name, category: input.category, unit: input.unit, reorderLevel: input.reorderLevel,
    unitCost: toMoneyString(input.unitCost), location: input.location ?? null, isActive: true,
  };
}

export async function createItem(input, session, ip) {
  const dup = await prisma.inventoryItem.findUnique({ where: { code: input.code }, select: { id: true } });
  if (dup) throw conflict("An item with this code already exists.", { code: "Code already in use" });
  return prisma.$transaction(async (tx) => {
    const it = await tx.inventoryItem.create({ data: itemData(input) });
    await audit({ userId: session.user.id, action: "inventory.item.create", entityType: "InventoryItem", entityId: it.id, metadata: { code: it.code }, ipAddress: ip }, tx);
    return it;
  });
}

export async function updateItem(id, input, session, ip) {
  const existing = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!existing) throw notFound();
  if (input.code !== existing.code) {
    const dup = await prisma.inventoryItem.findUnique({ where: { code: input.code }, select: { id: true } });
    if (dup) throw conflict("An item with this code already exists.", { code: "Code already in use" });
  }
  // Activation is only changed through setItemActive (separately audited).
  const data = { ...itemData(input), isActive: existing.isActive };
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  return prisma.$transaction(async (tx) => {
    const it = await tx.inventoryItem.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: "inventory.item.update", entityType: "InventoryItem", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return it;
  });
}

export async function setItemActive(id, isActive, reason, session, ip) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.inventoryItem.updateMany({ where: { id, isActive: !isActive }, data: { isActive } });
    if (!r.count) {
      if (!(await tx.inventoryItem.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
      throw invalidState(isActive ? "Item is already active." : "Item is already inactive.");
    }
    await audit({ userId: session.user.id, action: isActive ? "inventory.item.activate" : "inventory.item.deactivate", entityType: "InventoryItem", entityId: id, metadata: reason ? { reason } : undefined, ipAddress: ip }, tx);
    return { id, isActive };
  });
}

export async function getItem(id) {
  const it = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!it) return null;
  const poLines = await prisma.purchaseOrderItem.findMany({
    where: { inventoryItemId: id },
    orderBy: { purchaseOrder: { createdAt: "desc" } },
    take: 20,
    include: { purchaseOrder: { select: { id: true, poNumber: true, status: true, createdAt: true, receivedAt: true, supplier: { select: { id: true, name: true } } } } },
  });
  return { ...it, value: toMoneyString(D(it.unitCost).mul(it.quantity)), poLines };
}

async function notifyIfLow(item) {
  if (item.quantity > item.reorderLevel) return;
  try {
    await notifyPermission(["inventory:manage"], { category: "SYSTEM", title: "Inventory low stock", body: `${item.name} (${item.code}) is at or below its reorder level.`, link: "/inventory?tab=items&stock=low" });
  } catch (e) {
    console.error("[inventory] low-stock notification failed", e?.code ?? "", String(e?.message || "").slice(0, 200));
  }
}

/** Issue stock to a department (ISSUE movement; conditional decrement — never negative). */
export async function issueItem(id, { departmentId, quantity, note }, session, ip) {
  const [item, dept] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id }, select: { id: true, code: true, name: true, isActive: true } }),
    prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true, isActive: true } }),
  ]);
  if (!item) throw notFound("Item not found");
  if (!item.isActive) throw invalidState("This item is inactive and cannot be issued.");
  if (!dept || !dept.isActive) throw fieldError("departmentId", "Choose an active department");
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.inventoryItem.updateMany({ where: { id, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } });
    if (!r.count) {
      const cur = await tx.inventoryItem.findUnique({ where: { id }, select: { quantity: true } });
      throw fieldError("quantity", `Insufficient stock: only ${cur?.quantity ?? 0} on hand`);
    }
    const after = await tx.inventoryItem.findUnique({ where: { id }, select: { id: true, code: true, name: true, quantity: true, reorderLevel: true } });
    await tx.stockMovement.create({
      data: { type: "ISSUE", inventoryItemId: id, quantity: -quantity, balanceAfter: after.quantity, reason: `Issued to ${dept.name}${note ? ` — ${note}` : ""}`, referenceType: "Department", referenceId: dept.id, performedById: session.user.id },
    });
    await audit({ userId: session.user.id, action: "inventory.issue", entityType: "InventoryItem", entityId: id, metadata: { quantity, departmentId: dept.id }, ipAddress: ip }, tx);
    return after;
  });
  await notifyIfLow(updated);
  return updated;
}

export async function adjustItem(id, { direction, quantity, reason }, session, ip) {
  const item = await prisma.inventoryItem.findUnique({ where: { id }, select: { id: true } });
  if (!item) throw notFound("Item not found");
  return prisma.$transaction(async (tx) => {
    if (direction === "OUT") {
      const r = await tx.inventoryItem.updateMany({ where: { id, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } });
      if (!r.count) throw fieldError("quantity", "Insufficient stock for this decrease");
    } else {
      await tx.inventoryItem.update({ where: { id }, data: { quantity: { increment: quantity } } });
    }
    const after = await tx.inventoryItem.findUnique({ where: { id }, select: { quantity: true } });
    const signed = direction === "OUT" ? -quantity : quantity;
    await tx.stockMovement.create({ data: { type: "ADJUSTMENT", inventoryItemId: id, quantity: signed, balanceAfter: after.quantity, reason, performedById: session.user.id } });
    await audit({ userId: session.user.id, action: "inventory.adjust", entityType: "InventoryItem", entityId: id, metadata: { quantity: signed, reason }, ipAddress: ip }, tx);
    return { id, quantity: after.quantity };
  });
}

export async function itemOptions({ activeOnly = true } = {}) {
  return prisma.inventoryItem.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: { name: "asc" }, take: 1000, select: { id: true, code: true, name: true, unit: true, unitCost: true, isActive: true } });
}

export async function departmentOptions() {
  return prisma.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } });
}

// ───────────────────────────── Ledger ─────────────────────────────

export async function listInventoryLedger({ q, page, pageSize, dir, itemId, type, from, to }, tz) {
  const where = { inventoryItemId: itemId || { not: null }, ...dateWhere("createdAt", from, to, tz) };
  if (type) where.type = type;
  if (q) where.OR = [{ reason: ci(q) }, { inventoryItem: { OR: [{ code: ci(q) }, { name: ci(q) }] } }];
  const [total, rows] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where, orderBy: [{ createdAt: dir === "asc" ? "asc" : "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
      include: { inventoryItem: { select: { id: true, code: true, name: true, unit: true } } },
    }),
  ]);
  const names = await userNames(rows.map((r) => r.performedById));
  const poIds = rows.filter((r) => r.referenceType === "PurchaseOrder" && r.referenceId).map((r) => r.referenceId);
  const pos = poIds.length ? await prisma.purchaseOrder.findMany({ where: { id: { in: [...new Set(poIds)] } }, select: { id: true, poNumber: true } }) : [];
  const poMap = new Map(pos.map((p) => [p.id, p]));
  return {
    rows: rows.map((r) => ({ ...r, performedByName: names.get(r.performedById) || "—", purchaseOrder: r.referenceType === "PurchaseOrder" ? poMap.get(r.referenceId) ?? null : null })),
    meta: pageMeta(total, page, pageSize),
  };
}

// ───────────────────────────── Suppliers ─────────────────────────────

export async function listSuppliers({ q, page, pageSize, sort, dir, status }) {
  const where = {};
  if (q) where.OR = [{ name: ci(q) }, { phone: { contains: q } }, { email: ci(q) }];
  if (status === "INACTIVE") where.isActive = false;
  else if (status === "ACTIVE") where.isActive = true;
  const orderBy = sort === "name" || !sort ? [{ name: dir }] : [{ name: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { purchaseOrders: true } } } }),
  ]);
  const ids = rows.map((r) => r.id);
  const received = ids.length
    ? await prisma.purchaseOrder.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "RECEIVED" }, _sum: { total: true } })
    : [];
  const open = ids.length
    ? await prisma.purchaseOrder.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: { in: ["DRAFT", "ORDERED"] } }, _sum: { total: true }, _count: { _all: true } })
    : [];
  const recMap = new Map(received.map((r) => [r.supplierId, r._sum.total]));
  const openMap = new Map(open.map((r) => [r.supplierId, r]));
  return {
    rows: rows.map((r) => ({
      ...r,
      receivedValue: toMoneyString(recMap.get(r.id) ?? 0),
      openCount: openMap.get(r.id)?._count._all ?? 0,
      openValue: toMoneyString(openMap.get(r.id)?._sum.total ?? 0),
    })),
    meta: pageMeta(total, page, pageSize),
  };
}

export async function lookupSuppliers({ q, pageSize = 20, includeInactive = false }) {
  const where = includeInactive ? {} : { isActive: true };
  if (q) where.name = ci(q);
  return prisma.supplier.findMany({ where, orderBy: { name: "asc" }, take: pageSize, select: { id: true, name: true, phone: true, email: true, isActive: true } });
}

function supplierData(input) {
  return { name: input.name, phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, address: input.address ?? null };
}

export async function createSupplier(input, session, ip) {
  const dup = await prisma.supplier.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } }, select: { id: true } });
  if (dup) throw conflict("A supplier with this name already exists.", { name: "Name already in use" });
  return prisma.$transaction(async (tx) => {
    const s = await tx.supplier.create({ data: supplierData(input) });
    await audit({ userId: session.user.id, action: "supplier.create", entityType: "Supplier", entityId: s.id, ipAddress: ip }, tx);
    return s;
  });
}

export async function updateSupplier(id, input, session, ip) {
  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw notFound();
  const dup = await prisma.supplier.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, id: { not: id } }, select: { id: true } });
  if (dup) throw conflict("A supplier with this name already exists.", { name: "Name already in use" });
  const data = supplierData(input);
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  return prisma.$transaction(async (tx) => {
    const s = await tx.supplier.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: "supplier.update", entityType: "Supplier", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return s;
  });
}

export async function setSupplierActive(id, isActive, reason, session, ip) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.supplier.updateMany({ where: { id, isActive: !isActive }, data: { isActive } });
    if (!r.count) {
      if (!(await tx.supplier.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
      throw invalidState(isActive ? "Supplier is already active." : "Supplier is already inactive.");
    }
    await audit({ userId: session.user.id, action: isActive ? "supplier.activate" : "supplier.deactivate", entityType: "Supplier", entityId: id, metadata: reason ? { reason } : undefined, ipAddress: ip }, tx);
    return { id, isActive };
  });
}

/**
 * Supplier profile with purchase history and received-value totals.
 * There is no supplier payment model, so balances/payables are deliberately NOT computed.
 */
export async function getSupplier(id, { includePharmacy = false } = {}) {
  const s = await prisma.supplier.findUnique({ where: { id } });
  if (!s) return null;
  const [byStatus, orders, pharmacyRows, recentBatches] = await Promise.all([
    prisma.purchaseOrder.groupBy({ by: ["status"], where: { supplierId: id }, _sum: { total: true }, _count: { _all: true } }),
    prisma.purchaseOrder.findMany({ where: { supplierId: id }, orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { items: true } } } }),
    includePharmacy
      ? prisma.$queryRaw`SELECT COALESCE(SUM(sm.quantity * b."purchaseCost"), 0)::text AS value, COUNT(DISTINCT b.id)::int AS batches
          FROM "StockMovement" sm JOIN "MedicationBatch" b ON b.id = sm."batchId"
          WHERE sm.type = 'RECEIPT' AND b."supplierId" = ${id}`
      : [],
    includePharmacy
      ? prisma.medicationBatch.findMany({ where: { supplierId: id }, orderBy: { receivedAt: "desc" }, take: 20, include: { medication: { select: { id: true, genericName: true, strength: true } } } })
      : [],
  ]);
  const stat = Object.fromEntries(byStatus.map((r) => [r.status, { count: r._count._all, total: toMoneyString(r._sum.total ?? 0) }]));
  const openValue = toMoneyString(D(stat.DRAFT?.total ?? 0).plus(D(stat.ORDERED?.total ?? 0)));
  return {
    ...s,
    orders,
    totals: {
      poCount: byStatus.reduce((n, r) => n + r._count._all, 0),
      receivedValue: stat.RECEIVED?.total ?? "0.00",
      receivedCount: stat.RECEIVED?.count ?? 0,
      openValue,
      openCount: (stat.DRAFT?.count ?? 0) + (stat.ORDERED?.count ?? 0),
      pharmacyReceivedValue: includePharmacy ? toMoneyString(pharmacyRows[0]?.value ?? 0) : null,
      pharmacyBatches: includePharmacy ? pharmacyRows[0]?.batches ?? 0 : null,
    },
    recentBatches,
  };
}

// ───────────────────────────── Purchase orders ─────────────────────────────

const PO_SORT = { createdAt: ["createdAt"], poNumber: ["poNumber"], total: ["total"] };

export async function listPurchaseOrders({ q, page, pageSize, sort, dir, status, from, to, supplierId }, tz) {
  const where = { ...dateWhere("createdAt", from, to, tz) };
  if (status && ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"].includes(status)) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (q) where.OR = [{ poNumber: ci(q) }, { supplier: { name: ci(q) } }];
  const orderBy = (PO_SORT[sort] || PO_SORT.createdAt).map((f) => ({ [f]: dir }));
  const [total, rows] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { supplier: { select: { id: true, name: true } }, _count: { select: { items: true } } } }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function getPurchaseOrder(id) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { orderBy: { id: "asc" }, include: { inventoryItem: { select: { id: true, code: true, name: true, unit: true, isActive: true } } } },
    },
  });
  if (!po) return null;
  const [createdBy, history] = await Promise.all([
    po.createdById ? prisma.user.findUnique({ where: { id: po.createdById }, select: { name: true } }) : null,
    prisma.auditLog.findMany({ where: { entityType: "PurchaseOrder", entityId: id }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } }),
  ]);
  return {
    ...po,
    createdByName: createdBy?.name ?? null,
    items: po.items.map((l) => ({ ...l, lineTotal: toMoneyString(D(l.unitCost).mul(l.quantity)) })),
    history,
  };
}

async function validatePoInput(input) {
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, isActive: true } });
  if (!supplier || !supplier.isActive) throw fieldError("supplierId", "Choose an active supplier");
  const ids = input.items.map((l) => l.inventoryItemId);
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } });
  const ok = new Map(items.map((i) => [i.id, i]));
  input.items.forEach((l, idx) => {
    const it = ok.get(l.inventoryItemId);
    if (!it || !it.isActive) throw fieldError(`items.${idx}.inventoryItemId`, "Choose an active item");
  });
}

const lineData = (l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity, unitCost: toMoneyString(l.unitCost) });

export async function createPurchaseOrder(input, session, ip) {
  await validatePoInput(input);
  const total = calcPoTotal(input.items);
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: { poNumber: await newId(tx, "purchaseOrder"), supplierId: input.supplierId, status: "DRAFT", total, createdById: session.user.id, items: { create: input.items.map(lineData) } },
    });
    await audit({ userId: session.user.id, action: "purchaseOrder.create", entityType: "PurchaseOrder", entityId: po.id, metadata: { poNumber: po.poNumber, lines: input.items.length, total }, ipAddress: ip }, tx);
    return po;
  });
}

export async function updatePurchaseOrder(id, input, session, ip) {
  await validatePoInput(input);
  const total = calcPoTotal(input.items);
  return prisma.$transaction(async (tx) => {
    // Conditional update doubles as the DRAFT check and the row lock.
    const r = await tx.purchaseOrder.updateMany({ where: { id, status: "DRAFT" }, data: { supplierId: input.supplierId, total } });
    if (!r.count) {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, select: { status: true } });
      if (!po) throw notFound();
      throw invalidState(`Only draft purchase orders can be edited (this one is ${humanize(po.status).toLowerCase()}).`);
    }
    // Draft lines are not yet a financial commitment, so they are replaced wholesale.
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    await tx.purchaseOrderItem.createMany({ data: input.items.map((l) => ({ ...lineData(l), purchaseOrderId: id })) });
    await audit({ userId: session.user.id, action: "purchaseOrder.update", entityType: "PurchaseOrder", entityId: id, metadata: { lines: input.items.length, total }, ipAddress: ip }, tx);
    return tx.purchaseOrder.findUnique({ where: { id } });
  });
}

/** Race-safe status transition: DRAFT→ORDERED→RECEIVED, DRAFT/ORDERED→CANCELLED. */
export async function transitionPurchaseOrder(id, { status: to, reason }, session, ip) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true, poNumber: true, status: true, supplier: { select: { isActive: true } } } });
  if (!po) throw notFound();
  if (!canTransitionPo(po.status, to)) throw invalidState(`Cannot change a ${humanize(po.status).toLowerCase()} purchase order to ${humanize(to).toLowerCase()}.`);
  if (to === "ORDERED" && !po.supplier.isActive) throw invalidState("The supplier is inactive. Reactivate the supplier or choose another before ordering.");
  const from = po.status;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const data = { status: to };
    if (to === "ORDERED") data.orderedAt = now;
    if (to === "RECEIVED") data.receivedAt = now;
    const r = await tx.purchaseOrder.updateMany({ where: { id, status: from }, data });
    if (!r.count) throw invalidState("This purchase order was changed by someone else. Refresh and try again.");
    let received = 0;
    if (to === "RECEIVED") {
      const lines = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id }, orderBy: { inventoryItemId: "asc" } });
      if (!lines.length) throw invalidState("This purchase order has no lines to receive.");
      for (const l of lines) {
        // Increment stock and record the latest purchase cost on the item.
        const it = await tx.inventoryItem.update({ where: { id: l.inventoryItemId }, data: { quantity: { increment: l.quantity }, unitCost: l.unitCost }, select: { quantity: true } });
        await tx.stockMovement.create({
          data: { type: "RECEIPT", inventoryItemId: l.inventoryItemId, quantity: l.quantity, balanceAfter: it.quantity, reason: `Received on ${po.poNumber}`, referenceType: "PurchaseOrder", referenceId: id, performedById: session.user.id },
        });
        received += l.quantity;
      }
    }
    await audit({
      userId: session.user.id, action: `purchaseOrder.${to.toLowerCase()}`, entityType: "PurchaseOrder", entityId: id,
      metadata: { poNumber: po.poNumber, from, to, ...(reason ? { reason } : {}), ...(to === "RECEIVED" ? { unitsReceived: received } : {}) }, ipAddress: ip,
    }, tx);
    return { id, status: to };
  }, { timeout: 20000 });
}
