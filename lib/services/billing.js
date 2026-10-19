import "server-only";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/session";
import { ApiError, conflict, notFound, invalidState, forbidden, badRequest } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { dayRangeUtc, todayInTz, formatDateTime, formatDate } from "@/lib/utils/time";
import { D, toMoneyString } from "@/lib/utils/money";
import { getHospital, getSetting } from "@/lib/services/settings";
import { patientSearchWhere } from "@/lib/services/patients";
import {
  INSURANCE_METHOD, AGEING_BUCKETS, bedDays, netDispensedQty, pharmacyBillableQty, buildLine, invoiceTotals,
  deriveInvoiceStatus, paymentGuard, refundGuard, voidGuard, issueGuard, ageingRange, daysSince, methodLabel,
} from "@/lib/validation/billing";
import { OPEN_CLAIM_STATUSES } from "@/lib/validation/insurance";

const OPEN = ["ISSUED", "PARTIALLY_PAID"];
const TX = { timeout: 20000, maxWait: 10000 };
const ci = (v) => ({ contains: v, mode: "insensitive" });
const fieldError = (field, message) => new ApiError(422, "VALIDATION_ERROR", message, { [field]: message });
const fullName = (p) => (p ? `${p.firstName} ${p.lastName}` : "");

// ───────────────────────────── Settings helpers ─────────────────────────────

export async function getBillingSettings() {
  const b = await getSetting("billing");
  const methods = Array.isArray(b?.paymentMethods) ? b.paymentMethods.filter((m) => m && m !== INSURANCE_METHOD) : ["CASH"];
  return { taxRatePercent: String(b?.taxRatePercent ?? "0"), paymentMethods: methods, maxDiscountPercentWithoutApproval: Number(b?.maxDiscountPercentWithoutApproval ?? 0) };
}

/** Manual billable services configured in SystemSetting "services.catalog". */
export async function getServiceCatalog() {
  const c = await getSetting("services.catalog");
  const items = Array.isArray(c?.items) ? c.items : [];
  return items.filter((i) => i && i.code && i.name).map((i) => ({ code: String(i.code), name: String(i.name), category: String(i.category || "MISC"), price: toMoneyString(i.price ?? 0) }));
}

// ───────────────────────────── Unbilled charges ─────────────────────────────

const key = (sourceType, sourceId) => `${sourceType}|${sourceId}`;

async function runAll(db, fns) {
  // Interactive transactions run on one connection: keep their queries sequential.
  if (db === prisma) return Promise.all(fns.map((f) => f()));
  const out = [];
  for (const f of fns) out.push(await f());
  return out;
}

/**
 * Billable source rows of a patient that are not yet on a non-VOID invoice.
 *  - Encounter (FINALIZED, OPD/EMERGENCY) → CONSULTATION at appointment fee, else the doctor's consultation fee.
 *  - LabOrderItem (order not CANCELLED/REJECTED) → LAB at the order-item price.
 *  - ImagingStudy (not CANCELLED) → IMAGING at the study price.
 *  - PrescriptionItem → PHARMACY: net dispensed qty (DISPENSE − RETURN ledger rows; falls back to dispensedQty when
 *    no ledger rows reference the item) minus quantity already billed, × current selling price. Additional dispensing
 *    after billing is offered as a further line with the same sourceType/sourceId; returns after billing are
 *    reported in `credits` (handled through a refund, since invoice lines cannot be negative).
 *  - BedAssignment → BED: ceil(days) (min 1) × ward daily rate. Ended assignments (or discharged admissions) bill
 *    the remaining days as sourceType "BedAssignment". Running stays can be billed as an interim charge with
 *    sourceType "BedAssignment:interim:<YYYY-MM-DD>"; billed days are subtracted when the stay is finally billed.
 *  - Procedure (COMPLETED) → PROCEDURE at its charge.
 */
export async function getUnbilledCharges(patientId, { db = prisma, tz, now = new Date() } = {}) {
  if (!tz) tz = (await getHospital()).timezone;
  const [encounters, labItems, studies, billedRx, assignments, procedures] = await runAll(db, [
    () => db.encounter.findMany({
      where: { patientId, status: "FINALIZED", type: { in: ["OPD", "EMERGENCY"] } },
      select: { id: true, encounterNo: true, type: true, startedAt: true, finalizedAt: true, appointment: { select: { fee: true } }, doctor: { select: { consultationFee: true, staff: { select: { firstName: true, lastName: true } } } } },
    }),
    () => db.labOrderItem.findMany({
      where: { order: { patientId, status: { notIn: ["CANCELLED", "REJECTED"] } } },
      select: { id: true, price: true, test: { select: { name: true } }, order: { select: { orderNo: true, createdAt: true, encounterId: true } } },
    }),
    () => db.imagingStudy.findMany({ where: { patientId, status: { not: "CANCELLED" } }, select: { id: true, studyNo: true, modality: true, bodyPart: true, price: true, createdAt: true, encounterId: true } }),
    () => db.invoiceItem.findMany({ where: { sourceType: "PrescriptionItem", invoice: { patientId, status: { not: "VOID" } } }, select: { sourceId: true } }),
    () => db.bedAssignment.findMany({
      where: { admission: { patientId, status: { not: "CANCELLED" } } },
      select: { id: true, startedAt: true, endedAt: true, bed: { select: { label: true, ward: { select: { name: true, dailyRate: true } } } }, admission: { select: { admissionNo: true, status: true, dischargedAt: true } } },
    }),
    () => db.procedure.findMany({ where: { patientId, status: "COMPLETED" }, select: { id: true, procedureNo: true, name: true, charge: true, scheduledStart: true } }),
  ]);

  const billedRxIds = [...new Set(billedRx.map((r) => r.sourceId).filter(Boolean))];
  const rxItems = await db.prescriptionItem.findMany({
    where: { prescription: { patientId }, OR: [{ dispensedQty: { gt: 0 } }, ...(billedRxIds.length ? [{ id: { in: billedRxIds } }] : [])] },
    select: {
      id: true, prescriptionId: true, medicationId: true, dispensedQty: true,
      medication: { select: { genericName: true, brandName: true, strength: true, sellingPrice: true } },
      prescription: { select: { prescriptionNo: true, issuedAt: true, createdAt: true, encounterId: true } },
    },
  });
  const movements = rxItems.length ? await db.stockMovement.findMany({
    where: {
      type: { in: ["DISPENSE", "RETURN"] },
      OR: [
        { referenceType: "PrescriptionItem", referenceId: { in: rxItems.map((i) => i.id) } },
        { referenceType: "Prescription", referenceId: { in: [...new Set(rxItems.map((i) => i.prescriptionId))] } },
      ],
    },
    select: { type: true, quantity: true, medicationId: true, referenceType: true, referenceId: true },
  }) : [];

  const sourceIds = [
    ...encounters.map((e) => e.id), ...labItems.map((i) => i.id), ...studies.map((s) => s.id),
    ...rxItems.map((i) => i.id), ...assignments.map((a) => a.id), ...procedures.map((p) => p.id),
  ];
  const billed = sourceIds.length ? await db.invoiceItem.findMany({
    where: { sourceId: { in: sourceIds }, invoice: { status: { not: "VOID" } } },
    select: { sourceType: true, sourceId: true, quantity: true },
  }) : [];
  const billedKeys = new Set(billed.map((b) => key(b.sourceType, b.sourceId)));
  const billedQty = (sourceId, pred) => billed.filter((b) => b.sourceId === sourceId && pred(b.sourceType || "")).reduce((s, b) => s + b.quantity, 0);

  const charges = [];
  const credits = [];
  const push = (c) => charges.push({ ...c, key: key(c.sourceType, c.sourceId), unitPrice: toMoneyString(c.unitPrice), amount: toMoneyString(D(c.unitPrice).mul(c.quantity)) });

  for (const e of encounters) {
    if (billedKeys.has(key("Encounter", e.id))) continue;
    const fee = e.appointment?.fee ?? e.doctor.consultationFee;
    push({
      sourceType: "Encounter", sourceId: e.id, category: "CONSULTATION", reference: e.encounterNo, date: e.finalizedAt ?? e.startedAt,
      description: `${e.type === "EMERGENCY" ? "Emergency consultation" : "Consultation"} — Dr. ${fullName(e.doctor.staff)}`,
      quantity: 1, unitPrice: fee, encounterId: e.id,
    });
  }
  for (const i of labItems) {
    if (billedKeys.has(key("LabOrderItem", i.id))) continue;
    push({ sourceType: "LabOrderItem", sourceId: i.id, category: "LAB", reference: i.order.orderNo, date: i.order.createdAt, description: i.test.name, quantity: 1, unitPrice: i.price, encounterId: i.order.encounterId });
  }
  for (const s of studies) {
    if (billedKeys.has(key("ImagingStudy", s.id))) continue;
    push({ sourceType: "ImagingStudy", sourceId: s.id, category: "IMAGING", reference: s.studyNo, date: s.createdAt, description: `${s.modality} — ${s.bodyPart}`, quantity: 1, unitPrice: s.price, encounterId: s.encounterId });
  }
  for (const p of procedures) {
    if (billedKeys.has(key("Procedure", p.id))) continue;
    push({ sourceType: "Procedure", sourceId: p.id, category: "PROCEDURE", reference: p.procedureNo, date: p.scheduledStart, description: p.name, quantity: 1, unitPrice: p.charge, encounterId: null });
  }
  for (const it of rxItems) {
    const own = movements.filter((m) => m.referenceType === "PrescriptionItem" && m.referenceId === it.id);
    const viaRx = own.length ? [] : movements.filter((m) => m.referenceType === "Prescription" && m.referenceId === it.prescriptionId && m.medicationId === it.medicationId);
    const net = netDispensedQty(own.length ? own : viaRx, it.dispensedQty);
    const already = billedQty(it.id, (t) => t === "PrescriptionItem");
    const { qty, credit } = pharmacyBillableQty(net, already);
    const med = it.medication;
    const name = `${med.genericName} ${med.strength}${med.brandName ? ` (${med.brandName})` : ""}`;
    const date = it.prescription.issuedAt ?? it.prescription.createdAt;
    if (qty > 0) {
      push({
        sourceType: "PrescriptionItem", sourceId: it.id, category: "PHARMACY", reference: it.prescription.prescriptionNo, date,
        description: already > 0 ? `${name} — additional ${qty} dispensed (${already} already billed)` : name,
        quantity: qty, unitPrice: med.sellingPrice, encounterId: it.prescription.encounterId,
      });
    } else if (credit > 0) {
      credits.push({ sourceType: "PrescriptionItem", sourceId: it.id, reference: it.prescription.prescriptionNo, description: `${name} — ${credit} returned after billing`, quantity: credit, amount: toMoneyString(D(med.sellingPrice).mul(credit)) });
    }
  }
  const today = todayInTz(tz);
  for (const a of assignments) {
    const end = a.endedAt ?? (a.admission.status !== "ADMITTED" ? a.admission.dischargedAt : null);
    const already = billedQty(a.id, (t) => t === "BedAssignment" || t.startsWith("BedAssignment:"));
    const where = `${a.bed.ward.name} (${a.bed.label})`;
    if (end) {
      const total = bedDays(a.startedAt, end);
      const qty = total - already;
      if (qty <= 0) continue;
      push({
        sourceType: "BedAssignment", sourceId: a.id, category: "BED", reference: a.admission.admissionNo, date: end,
        description: `Bed — ${where}, ${formatDate(a.startedAt, tz)} to ${formatDate(end, tz)}${already ? ` (${qty} day(s) after interim billing)` : ""}`,
        quantity: qty, unitPrice: a.bed.ward.dailyRate, encounterId: null,
      });
    } else {
      const soFar = bedDays(a.startedAt, now);
      const qty = soFar - already;
      if (qty <= 0) continue;
      push({
        sourceType: `BedAssignment:interim:${today}`, sourceId: a.id, category: "BED", reference: a.admission.admissionNo, date: now, interim: true,
        description: `Bed — ${where}, interim ${qty} day(s) to ${formatDate(now, tz)} (stay ongoing)`,
        quantity: qty, unitPrice: a.bed.ward.dailyRate, encounterId: null,
      });
    }
  }
  charges.sort((x, y) => new Date(y.date) - new Date(x.date));
  return { charges, credits };
}

// ───────────────────────────── Locks & recompute ─────────────────────────────

async function lockPatientBilling(tx, patientId) {
  // Serialises "is this source still unbilled?" checks per patient so concurrent requests cannot bill a source twice.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`billing:${patientId}`}))`;
}

async function lockInvoice(tx, id) {
  const rows = await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw notFound("Invoice not found");
  return tx.invoice.findUnique({ where: { id } });
}

async function recomputeInvoice(tx, id) {
  const inv = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
  const t = invoiceTotals(inv.items, inv);
  const data = { subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, total: t.total, balance: t.balance };
  if (D(t.discountTotal).eq(0)) data.discountReason = null;
  return tx.invoice.update({ where: { id }, data });
}

async function resolveLines(tx, patientId, { sources = [], items = [] }, tz) {
  const [settings, catalog] = await Promise.all([getBillingSettings(), getServiceCatalog()]);
  const lines = [];
  if (sources.length) {
    const { charges } = await getUnbilledCharges(patientId, { db: tx, tz });
    const byKey = new Map(charges.map((c) => [c.key, c]));
    const seen = new Set();
    const missing = [];
    for (const s of sources) {
      const k = key(s.sourceType, s.sourceId);
      if (seen.has(k)) continue;
      seen.add(k);
      const c = byKey.get(k);
      if (!c) { missing.push(k); continue; }
      lines.push({
        category: c.category, description: `${c.description} · ${c.reference}`, sourceType: c.sourceType, sourceId: c.sourceId, encounterId: c.encounterId || null,
        ...buildLine({ quantity: c.quantity, unitPrice: c.unitPrice, discount: "0", taxRate: settings.taxRatePercent }),
      });
    }
    if (missing.length) throw conflict("Some selected charges were already billed or are no longer billable. Refresh the list and try again.", { missing });
  }
  for (const m of items) {
    let { category, description, unitPrice } = m;
    if (m.catalogCode) {
      const c = catalog.find((x) => x.code === m.catalogCode);
      if (!c) throw badRequest("Unknown service code. Refresh and try again.");
      category = c.category; unitPrice = c.price;
      description = description || c.name;
    }
    lines.push({ category: category || "MISC", description, sourceType: null, sourceId: null, encounterId: null, ...buildLine({ quantity: m.quantity, unitPrice, discount: "0", taxRate: m.taxRate ?? settings.taxRatePercent }) });
  }
  if (!lines.length) throw invalidState("Nothing to bill.");
  return lines;
}

// ───────────────────────────── Invoice lifecycle ─────────────────────────────

export async function createInvoice(input, session, ip) {
  const patient = await prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, status: true } });
  if (!patient || patient.status === "MERGED") throw notFound("Patient not found");
  const { timezone } = await getHospital();
  return prisma.$transaction(async (tx) => {
    await lockPatientBilling(tx, patient.id);
    const lines = await resolveLines(tx, patient.id, input, timezone);
    const inv = await tx.invoice.create({
      data: { invoiceNo: await newId(tx, "invoice"), patientId: patient.id, status: "DRAFT", createdById: session.user.id, items: { create: lines } },
    });
    const out = await recomputeInvoice(tx, inv.id);
    await audit({ userId: session.user.id, action: "invoice.create", entityType: "Invoice", entityId: inv.id, metadata: { invoiceNo: inv.invoiceNo, patientId: patient.id, lines: lines.length, sources: lines.filter((l) => l.sourceId).map((l) => `${l.sourceType}:${l.sourceId}`) }, ipAddress: ip }, tx);
    return out;
  }, TX);
}

async function requireDraft(tx, id) {
  const inv = await lockInvoice(tx, id);
  if (inv.status !== "DRAFT") throw invalidState("Only draft invoices can be changed. Issued invoices are locked.");
  return inv;
}

export async function addInvoiceItems(id, input, session, ip) {
  const { timezone } = await getHospital();
  return prisma.$transaction(async (tx) => {
    const inv = await requireDraft(tx, id);
    await lockPatientBilling(tx, inv.patientId);
    const lines = await resolveLines(tx, inv.patientId, input, timezone);
    await tx.invoiceItem.createMany({ data: lines.map((l) => ({ ...l, invoiceId: id })) });
    const out = await recomputeInvoice(tx, id);
    await audit({ userId: session.user.id, action: "invoice.items_add", entityType: "Invoice", entityId: id, metadata: { lines: lines.length, sources: lines.filter((l) => l.sourceId).map((l) => `${l.sourceType}:${l.sourceId}`) }, ipAddress: ip }, tx);
    return out;
  }, TX);
}

export async function removeInvoiceItem(id, itemId, session, ip) {
  return prisma.$transaction(async (tx) => {
    await requireDraft(tx, id);
    const item = await tx.invoiceItem.findFirst({ where: { id: itemId, invoiceId: id } });
    if (!item) throw notFound("Item not found");
    await tx.invoiceItem.delete({ where: { id: item.id } });
    const out = await recomputeInvoice(tx, id);
    await audit({ userId: session.user.id, action: "invoice.item_remove", entityType: "Invoice", entityId: id, metadata: { itemId, category: item.category, sourceType: item.sourceType, sourceId: item.sourceId, lineTotal: item.lineTotal.toString() }, ipAddress: ip }, tx);
    return out;
  }, TX);
}

export async function updateInvoiceLine(id, itemId, input, session, ip) {
  const settings = await getBillingSettings();
  return prisma.$transaction(async (tx) => {
    await requireDraft(tx, id);
    const item = await tx.invoiceItem.findFirst({ where: { id: itemId, invoiceId: id } });
    if (!item) throw notFound("Item not found");
    const discount = input.discount !== undefined ? input.discount : item.discount.toString();
    const taxRate = input.taxRate !== undefined ? input.taxRate : item.taxRate.toString();
    const discountChanged = !D(discount).eq(item.discount);
    const taxChanged = !D(taxRate).eq(item.taxRate);
    if (discountChanged && !can(session, "billing:discount")) throw forbidden("You do not have permission to apply discounts.");
    if (taxChanged && !can(session, "billing:create")) throw forbidden();
    let line;
    try { line = buildLine({ quantity: item.quantity, unitPrice: item.unitPrice.toString(), discount, taxRate }); }
    catch (e) { throw fieldError("discount", e.message || "Invalid discount"); }
    await tx.invoiceItem.update({ where: { id: item.id }, data: { discount: line.discount, taxRate: line.taxRate, lineTotal: line.lineTotal } });
    if (discountChanged && D(discount).gt(0)) await tx.invoice.update({ where: { id }, data: { discountReason: input.reason } });
    const out = await recomputeInvoice(tx, id);
    const gross = D(item.unitPrice).mul(item.quantity);
    const pct = gross.gt(0) ? D(discount).div(gross).mul(100) : D(0);
    if (discountChanged) {
      await audit({ userId: session.user.id, action: "invoice.discount", entityType: "Invoice", entityId: id, metadata: { itemId, previous: item.discount.toString(), discount: line.discount, percent: pct.toFixed(2), aboveThreshold: pct.gt(settings.maxDiscountPercentWithoutApproval), reason: input.reason ?? null }, ipAddress: ip }, tx);
    }
    if (taxChanged) {
      await audit({ userId: session.user.id, action: "invoice.tax_rate", entityType: "Invoice", entityId: id, metadata: { itemId, previous: item.taxRate.toString(), taxRate: line.taxRate }, ipAddress: ip }, tx);
    }
    return out;
  }, TX);
}

export async function issueInvoice(id, session, ip) {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    const count = await tx.invoiceItem.count({ where: { invoiceId: id } });
    const err = issueGuard(inv, count);
    if (err) throw invalidState(err);
    const fresh = await recomputeInvoice(tx, id);
    const status = deriveInvoiceStatus({ total: fresh.total, amountPaid: fresh.amountPaid, amountRefunded: fresh.amountRefunded });
    const r = await tx.invoice.updateMany({ where: { id, status: "DRAFT" }, data: { status, issuedAt: new Date() } });
    if (!r.count) throw invalidState("Invoice was changed by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "invoice.issue", entityType: "Invoice", entityId: id, metadata: { invoiceNo: inv.invoiceNo, total: fresh.total.toString() }, ipAddress: ip }, tx);
    return tx.invoice.findUnique({ where: { id } });
  }, TX);
}

/**
 * Posts a payment inside an existing transaction (shared by the cashier endpoint and insurance claim settlement).
 * Locks the invoice row, honours the idempotency key and recalculates amountPaid / balance / status.
 */
export async function applyPayment(tx, invoiceId, { amount, method, reference, idempotencyKey }, session, ip, { allowInsurance = false } = {}) {
  if (method === INSURANCE_METHOD && !allowInsurance) throw invalidState("Insurance payments are recorded by marking an insurance claim as paid.");
  await lockInvoice(tx, invoiceId);
  if (idempotencyKey) {
    const existing = await tx.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.invoiceId !== invoiceId) throw conflict("This payment request was already used for a different invoice.");
      return { payment: existing, duplicate: true };
    }
  }
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
  const settings = await getBillingSettings();
  const err = paymentGuard(inv, { amount, method }, settings.paymentMethods);
  if (err) throw invalidState(err);
  const payment = await tx.payment.create({
    data: { receiptNo: await newId(tx, "receipt"), invoiceId, amount: toMoneyString(amount), method, reference: reference ?? null, idempotencyKey: idempotencyKey ?? null, receivedById: session.user.id },
  });
  const amountPaid = D(inv.amountPaid).plus(D(amount));
  const balance = D(inv.total).minus(amountPaid.minus(D(inv.amountRefunded)));
  const status = deriveInvoiceStatus({ total: inv.total, amountPaid, amountRefunded: inv.amountRefunded });
  await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: toMoneyString(amountPaid), balance: toMoneyString(balance), status } });
  await audit({ userId: session.user.id, action: "invoice.payment", entityType: "Invoice", entityId: invoiceId, metadata: { paymentId: payment.id, receiptNo: payment.receiptNo, amount: payment.amount.toString(), method, status }, ipAddress: ip }, tx);
  return { payment, duplicate: false };
}

export async function recordPayment(invoiceId, input, session, ip) {
  try {
    return await prisma.$transaction((tx) => applyPayment(tx, invoiceId, input, session, ip), TX);
  } catch (e) {
    // A concurrent request with the same idempotency key won the race: return the stored payment.
    if (e?.code === "P2002" && input.idempotencyKey) {
      const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing && existing.invoiceId === invoiceId) return { payment: existing, duplicate: true };
    }
    throw e;
  }
}

export async function recordRefund(invoiceId, { amount, method, reason }, session, ip) {
  const settings = await getBillingSettings();
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    const err = refundGuard(inv, { amount, method }, settings.paymentMethods);
    if (err) throw invalidState(err);
    const refund = await tx.refund.create({ data: { invoiceId, amount: toMoneyString(amount), method, reason, approvedById: session.user.id } });
    const amountRefunded = D(inv.amountRefunded).plus(D(amount));
    const balance = D(inv.total).minus(D(inv.amountPaid).minus(amountRefunded));
    const status = deriveInvoiceStatus({ total: inv.total, amountPaid: inv.amountPaid, amountRefunded });
    await tx.invoice.update({ where: { id: invoiceId }, data: { amountRefunded: toMoneyString(amountRefunded), balance: toMoneyString(balance), status } });
    await audit({ userId: session.user.id, action: "invoice.refund", entityType: "Invoice", entityId: invoiceId, metadata: { refundId: refund.id, amount: refund.amount.toString(), method, reason, status }, ipAddress: ip }, tx);
    return refund;
  }, TX);
}

export async function voidInvoice(id, reason, session, ip) {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    const openClaims = await tx.insuranceClaim.count({ where: { invoiceId: id, status: { in: OPEN_CLAIM_STATUSES } } });
    const err = voidGuard(inv, { openClaims });
    if (err) throw invalidState(err);
    const r = await tx.invoice.updateMany({ where: { id, status: inv.status }, data: { status: "VOID", voidReason: reason } });
    if (!r.count) throw invalidState("Invoice was changed by someone else. Refresh and try again.");
    await audit({ userId: session.user.id, action: "invoice.void", entityType: "Invoice", entityId: id, metadata: { invoiceNo: inv.invoiceNo, previousStatus: inv.status, reason }, ipAddress: ip }, tx);
    return tx.invoice.findUnique({ where: { id } });
  }, TX);
}

// ───────────────────────────── Queries ─────────────────────────────

const SORTABLE = { createdAt: "createdAt", issuedAt: "issuedAt", invoiceNo: "invoiceNo", total: "total", balance: "balance" };

export async function listInvoices({ q, page, pageSize, sort, dir, status, from, to, patientId, claimable }, tz) {
  const where = {};
  if (q) where.OR = [{ invoiceNo: ci(q) }, { patient: patientSearchWhere(q) }];
  if (status === "OPEN") where.status = { in: OPEN };
  else if (status) where.status = status;
  if (claimable) where.status = { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] };
  if (patientId) where.patientId = patientId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.createdAt.lt = dayRangeUtc(to, tz)[1];
  }
  const orderBy = [{ [SORTABLE[sort] || "createdAt"]: dir || "desc" }, { id: "desc" }];
  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, invoiceNo: true, status: true, total: true, amountPaid: true, amountRefunded: true, balance: true, createdAt: true, issuedAt: true,
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } }, _count: { select: { items: true } },
      },
    }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function getBillingSummary(tz) {
  const [start, end] = dayRangeUtc(todayInTz(tz), tz);
  const [outstanding, collected, refunded, drafts] = await Promise.all([
    prisma.invoice.aggregate({ where: { status: { in: OPEN } }, _sum: { balance: true }, _count: true }),
    prisma.payment.aggregate({ where: { receivedAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
    prisma.refund.aggregate({ where: { createdAt: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
    prisma.invoice.count({ where: { status: "DRAFT" } }),
  ]);
  return {
    outstanding: toMoneyString(outstanding._sum.balance ?? 0), outstandingCount: outstanding._count,
    collectedToday: toMoneyString(collected._sum.amount ?? 0), paymentsToday: collected._count,
    refundedToday: toMoneyString(refunded._sum.amount ?? 0), refundsToday: refunded._count,
    drafts,
  };
}

export async function getAgeing(now = new Date()) {
  const rows = await Promise.all(AGEING_BUCKETS.map((b) => prisma.invoice.aggregate({ where: { status: { in: OPEN }, issuedAt: ageingRange(b, now) }, _sum: { balance: true }, _count: true })));
  return AGEING_BUCKETS.map((b, i) => ({ bucket: b, total: toMoneyString(rows[i]._sum.balance ?? 0), count: rows[i]._count }));
}

export async function listOutstanding({ q, page, pageSize, bucket }, now = new Date()) {
  const where = { status: { in: OPEN } };
  if (bucket && AGEING_BUCKETS.includes(bucket)) where.issuedAt = ageingRange(bucket, now);
  if (q) where.OR = [{ invoiceNo: ci(q) }, { patient: patientSearchWhere(q) }];
  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where, orderBy: [{ issuedAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, invoiceNo: true, status: true, total: true, balance: true, issuedAt: true, patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } } },
    }),
  ]);
  return { rows: rows.map((r) => ({ ...r, days: r.issuedAt ? daysSince(r.issuedAt, now) : 0 })), meta: pageMeta(total, page, pageSize) };
}

export async function listPayments({ q, page, pageSize, from, to, method }, tz) {
  const where = {};
  if (q) where.OR = [{ receiptNo: ci(q) }, { reference: ci(q) }, { invoice: { invoiceNo: ci(q) } }, { invoice: { patient: patientSearchWhere(q) } }];
  if (method) where.method = method;
  if (from || to) {
    where.receivedAt = {};
    if (from) where.receivedAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.receivedAt.lt = dayRangeUtc(to, tz)[1];
  }
  const [total, rows, sum] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, receiptNo: true, amount: true, method: true, reference: true, receivedAt: true, receivedById: true, invoice: { select: { id: true, invoiceNo: true, patient: { select: { mrn: true, firstName: true, lastName: true } } } } },
    }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
  ]);
  const names = await userNames(rows.map((r) => r.receivedById));
  return { rows: rows.map((r) => ({ ...r, receivedBy: names[r.receivedById] || "—" })), meta: pageMeta(total, page, pageSize), sum: toMoneyString(sum._sum.amount ?? 0) };
}

async function userNames(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}

export async function getInvoiceDetail(id) {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phone: true, address: true, city: true, status: true } },
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { receivedAt: "asc" } },
      refunds: { orderBy: { createdAt: "asc" } },
      claims: { orderBy: { createdAt: "desc" }, include: { policy: { select: { policyNumber: true, provider: { select: { name: true } } } } } },
    },
  });
  if (!inv) return null;
  const names = await userNames([inv.createdById, ...inv.payments.map((p) => p.receivedById), ...inv.refunds.map((r) => r.approvedById)]);
  return {
    ...inv,
    createdBy: names[inv.createdById] || null,
    payments: inv.payments.map((p) => ({ ...p, receivedBy: names[p.receivedById] || "—" })),
    refunds: inv.refunds.map((r) => ({ ...r, approvedBy: names[r.approvedById] || "—" })),
  };
}

export async function getReceipt(paymentId) {
  const p = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { select: { id: true, invoiceNo: true, status: true, total: true, amountPaid: true, amountRefunded: true, balance: true, issuedAt: true, patient: { select: { mrn: true, firstName: true, lastName: true, phone: true } } } } },
  });
  if (!p) return null;
  const names = await userNames([p.receivedById]);
  return { ...p, receivedBy: names[p.receivedById] || "—" };
}

// ───────────────────────────── PDF ─────────────────────────────

// Standard PDF fonts use WinAnsi encoding: keep Latin-1 + common typographic punctuation.
const pdfText = (s) => String(s ?? "").replace(/[^ -~ -ÿ–—‘’“”•…€]/g, "?");
const group = (s) => { const [i, f] = s.split("."); return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f}`; };
const pdfMoney = (v, cur) => `${cur} ${group(D(v).toFixed(2))}`;

/** Renders an invoice to a PDF Buffer using pdfkit's built-in Helvetica. */
export function renderInvoicePdf(inv, hospital) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `Invoice ${inv.invoiceNo}`, Author: pdfText(hospital.name), Subject: "Invoice" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const tz = hospital.timezone, cur = hospital.currency;
    const L = 48, R = doc.page.width - 48, W = R - L;
    const muted = "#556274", ink = "#0f172a", line = "#d5dbe5";

    // Header
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(16).text(pdfText(hospital.name), L, 48, { width: W * 0.6 });
    doc.font("Helvetica").fontSize(9).fillColor(muted);
    for (const t of [hospital.address, [hospital.phone, hospital.email].filter(Boolean).join("  ·  ")].filter(Boolean)) doc.text(pdfText(t), { width: W * 0.6 });
    doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text(inv.status === "DRAFT" ? "DRAFT INVOICE" : "INVOICE", L, 48, { width: W, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(muted)
      .text(`Invoice no.: ${inv.invoiceNo}`, { width: W, align: "right" })
      .text(`Status: ${inv.status.replace(/_/g, " ")}`, { width: W, align: "right" })
      .text(`Date: ${formatDate(inv.issuedAt ?? inv.createdAt, tz)}`, { width: W, align: "right" });
    let y = Math.max(doc.y, 120) + 14;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(line).stroke();
    y += 10;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(muted).text("BILL TO", L, y);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(pdfText(fullName(inv.patient)), L, y + 12);
    doc.font("Helvetica").fontSize(9).fillColor(muted).text(`${inv.patient.mrn}${inv.patient.phone ? `  ·  ${pdfText(inv.patient.phone)}` : ""}`);
    y = doc.y + 16;

    // Items table
    const cols = [
      { label: "Description", w: W - 300, align: "left" }, { label: "Qty", w: 34, align: "right" }, { label: "Unit price", w: 74, align: "right" },
      { label: "Discount", w: 64, align: "right" }, { label: "Tax %", w: 40, align: "right" }, { label: "Amount", w: 88, align: "right" },
    ];
    const header = () => {
      doc.rect(L, y, W, 20).fill("#f1f4f8");
      let x = L + 6;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(muted);
      for (const c of cols) { doc.text(c.label.toUpperCase(), x, y + 6, { width: c.w - 8, align: c.align }); x += c.w; }
      y += 24;
    };
    header();
    doc.font("Helvetica").fontSize(9).fillColor(ink);
    for (const it of inv.items) {
      const desc = `${pdfText(it.description)}\n${it.category.charAt(0) + it.category.slice(1).toLowerCase()}`;
      const h = Math.max(doc.heightOfString(desc, { width: cols[0].w - 8 }), 12) + 8;
      if (y + h > doc.page.height - 120) { doc.addPage(); y = 48; header(); doc.font("Helvetica").fontSize(9).fillColor(ink); }
      const vals = [desc, String(it.quantity), group(D(it.unitPrice).toFixed(2)), D(it.discount).gt(0) ? group(D(it.discount).toFixed(2)) : "—", D(it.taxRate).toFixed(2), group(D(it.lineTotal).toFixed(2))];
      let x = L + 6;
      cols.forEach((c, i) => { doc.fillColor(ink).text(vals[i], x, y, { width: c.w - 8, align: c.align }); x += c.w; });
      y += h;
      doc.moveTo(L, y - 4).lineTo(R, y - 4).strokeColor("#eef1f5").stroke();
    }
    if (!inv.items.length) { doc.fillColor(muted).text("No items.", L + 6, y); y += 18; }

    // Totals
    if (y > doc.page.height - 220) { doc.addPage(); y = 48; }
    y += 8;
    const tot = [["Subtotal", inv.subtotal], ["Discount", D(inv.discountTotal).neg()], ["Tax", inv.taxTotal], ["Total", inv.total, true], ["Paid", inv.amountPaid], ...(D(inv.amountRefunded).gt(0) ? [["Refunded", D(inv.amountRefunded).neg()]] : []), ["Balance due", inv.balance, true]];
    for (const [label, v, bold] of tot) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10.5 : 9.5).fillColor(ink);
      doc.text(label, R - 250, y, { width: 140, align: "left" });
      doc.text(pdfMoney(v, cur), R - 150, y, { width: 150, align: "right" });
      y += bold ? 17 : 15;
    }
    if (inv.discountReason && D(inv.discountTotal).gt(0)) {
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(muted).text(`Discount reason: ${pdfText(inv.discountReason)}`, L, y + 2, { width: W });
      y = doc.y + 6;
    }

    // Payments
    if (inv.payments?.length) {
      y += 12;
      if (y > doc.page.height - 140) { doc.addPage(); y = 48; }
      doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text("Payments", L, y);
      y += 16;
      doc.font("Helvetica").fontSize(9);
      for (const p of inv.payments) {
        if (y > doc.page.height - 80) { doc.addPage(); y = 48; }
        doc.fillColor(ink).text(`${p.receiptNo}  ·  ${formatDateTime(p.receivedAt, tz)}  ·  ${methodLabel(p.method)}${p.reference ? `  ·  Ref ${pdfText(p.reference)}` : ""}`, L, y, { width: W - 160 });
        doc.text(pdfMoney(p.amount, cur), R - 150, y, { width: 150, align: "right" });
        y += 15;
      }
    }
    if (inv.status === "VOID") {
      y += 10;
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#c81e1e").text(`VOID${inv.voidReason ? ` — ${pdfText(inv.voidReason)}` : ""}`, L, y, { width: W });
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // let the footer sit inside the bottom margin without triggering a page break
      doc.font("Helvetica").fontSize(7.5).fillColor("#7b8798")
        .text(`Generated ${formatDateTime(new Date(), tz)} (${tz})  ·  ${pdfText(hospital.name)}  ·  Page ${i - range.start + 1} of ${range.count}`, L, doc.page.height - 36, { width: W, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

