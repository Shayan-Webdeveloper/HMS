import "server-only";
import { prisma } from "@/lib/db/prisma";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { conflict, notFound, invalidState } from "@/lib/errors";
import { pageMeta } from "@/lib/validation/common";
import { dayRangeUtc, toZonedDateString, todayInTz } from "@/lib/utils/time";
import { D, toMoneyString } from "@/lib/utils/money";
import { getHospital } from "@/lib/services/settings";
import { patientSearchWhere } from "@/lib/services/patients";
import { applyPayment } from "@/lib/services/billing";
import { INSURANCE_METHOD } from "@/lib/validation/billing";
import { OPEN_CLAIM_STATUSES, CLAIM_STATUSES, resolveClaimDecision, insuranceSettlementAmount, policyCoversDate, claimableRemaining } from "@/lib/validation/insurance";

const ci = (v) => ({ contains: v, mode: "insensitive" });
const TX = { timeout: 20000, maxWait: 10000 };
const CLAIMABLE_INVOICE = ["ISSUED", "PARTIALLY_PAID", "PAID"];

// ───────────────────────────── Providers ─────────────────────────────

export async function listProviders({ q, page, pageSize, status }) {
  const where = {};
  if (q) where.OR = [{ name: ci(q) }, { email: ci(q) }, { phone: { contains: q } }];
  if (status === "ACTIVE") where.isActive = true;
  if (status === "INACTIVE") where.isActive = false;
  const [total, rows] = await Promise.all([
    prisma.insuranceProvider.count({ where }),
    prisma.insuranceProvider.findMany({ where, orderBy: [{ isActive: "desc" }, { name: "asc" }], skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { policies: true } } } }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function activeProviders() {
  return prisma.insuranceProvider.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

async function uniqueName(fn) {
  try { return await fn(); }
  catch (e) { if (e?.code === "P2002") throw conflict("A provider with this name already exists.", { name: "A provider with this name already exists." }); throw e; }
}

export async function createProvider(input, session, ip) {
  return uniqueName(() => prisma.$transaction(async (tx) => {
    const p = await tx.insuranceProvider.create({ data: { name: input.name, phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, isActive: input.isActive ?? true } });
    await audit({ userId: session.user.id, action: "insurance.provider_create", entityType: "InsuranceProvider", entityId: p.id, ipAddress: ip }, tx);
    return p;
  }));
}

export async function updateProvider(id, input, session, ip) {
  const existing = await prisma.insuranceProvider.findUnique({ where: { id } });
  if (!existing) throw notFound("Provider not found");
  const data = { name: input.name, phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, isActive: input.isActive ?? existing.isActive };
  const changed = Object.keys(data).filter((k) => String(existing[k] ?? "") !== String(data[k] ?? ""));
  return uniqueName(() => prisma.$transaction(async (tx) => {
    const p = await tx.insuranceProvider.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: "insurance.provider_update", entityType: "InsuranceProvider", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return p;
  }));
}

export async function setProviderActive(id, isActive, session, ip) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.insuranceProvider.updateMany({ where: { id }, data: { isActive } });
    if (!r.count) throw notFound("Provider not found");
    await audit({ userId: session.user.id, action: isActive ? "insurance.provider_activate" : "insurance.provider_deactivate", entityType: "InsuranceProvider", entityId: id, ipAddress: ip }, tx);
    return tx.insuranceProvider.findUnique({ where: { id } });
  });
}

// ───────────────────────────── Policies ─────────────────────────────

export async function listPolicies({ q, page, pageSize, status, providerId, patientId }, tz) {
  const where = {};
  if (q) where.OR = [{ policyNumber: ci(q) }, { provider: { name: ci(q) } }, { patient: patientSearchWhere(q) }];
  if (providerId) where.providerId = providerId;
  if (patientId) where.patientId = patientId;
  const today = new Date(todayInTz(tz));
  if (status === "ACTIVE") Object.assign(where, { isActive: true, coverageEnd: { gte: today } });
  if (status === "EXPIRED") Object.assign(where, { coverageEnd: { lt: today } });
  if (status === "INACTIVE") where.isActive = false;
  const [total, rows] = await Promise.all([
    prisma.insurancePolicy.count({ where }),
    prisma.insurancePolicy.findMany({
      where, orderBy: [{ coverageEnd: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
      include: { provider: { select: { id: true, name: true, isActive: true } }, patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } }, _count: { select: { claims: true } } },
    }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

function policyData(input) {
  return {
    patientId: input.patientId, providerId: input.providerId, policyNumber: input.policyNumber.trim(),
    coverageStart: new Date(input.coverageStart), coverageEnd: new Date(input.coverageEnd),
    coverageNotes: input.coverageNotes ?? null, isActive: input.isActive ?? true,
  };
}

async function uniquePolicy(fn) {
  try { return await fn(); }
  catch (e) {
    if (e?.code === "P2002") throw conflict("This policy number is already registered with the selected provider.", { policyNumber: "Already registered with this provider" });
    throw e;
  }
}

async function checkPolicyRefs(input, { requireActiveProvider }) {
  const [patient, provider] = await Promise.all([
    prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, status: true } }),
    prisma.insuranceProvider.findUnique({ where: { id: input.providerId }, select: { id: true, isActive: true } }),
  ]);
  if (!patient || patient.status === "MERGED") throw notFound("Patient not found");
  if (!provider) throw notFound("Provider not found");
  if (requireActiveProvider && !provider.isActive) throw invalidState("This provider is inactive. Reactivate it before adding policies.");
}

export async function createPolicy(input, session, ip) {
  await checkPolicyRefs(input, { requireActiveProvider: true });
  return uniquePolicy(() => prisma.$transaction(async (tx) => {
    const p = await tx.insurancePolicy.create({ data: policyData(input) });
    await audit({ userId: session.user.id, action: "insurance.policy_create", entityType: "InsurancePolicy", entityId: p.id, metadata: { patientId: p.patientId, providerId: p.providerId }, ipAddress: ip }, tx);
    return p;
  }));
}

export async function updatePolicy(id, input, session, ip) {
  const existing = await prisma.insurancePolicy.findUnique({ where: { id } });
  if (!existing) throw notFound("Policy not found");
  await checkPolicyRefs(input, { requireActiveProvider: input.providerId !== existing.providerId });
  if (input.patientId !== existing.patientId) {
    const claims = await prisma.insuranceClaim.count({ where: { policyId: id } });
    if (claims) throw invalidState("This policy already has claims; its patient cannot be changed.");
  }
  const data = policyData(input);
  const changed = Object.keys(data).filter((k) => String(existing[k] instanceof Date ? existing[k].toISOString() : existing[k] ?? "") !== String(data[k] instanceof Date ? data[k].toISOString() : data[k] ?? ""));
  return uniquePolicy(() => prisma.$transaction(async (tx) => {
    const p = await tx.insurancePolicy.update({ where: { id }, data });
    await audit({ userId: session.user.id, action: "insurance.policy_update", entityType: "InsurancePolicy", entityId: id, metadata: { fields: changed }, ipAddress: ip }, tx);
    return p;
  }));
}

// ───────────────────────────── Claims ─────────────────────────────

export async function listClaims({ q, page, pageSize, status, from, to }, tz) {
  const where = {};
  if (q) where.OR = [{ claimNo: ci(q) }, { invoice: { invoiceNo: ci(q) } }, { policy: { policyNumber: ci(q) } }, { policy: { provider: { name: ci(q) } } }, { invoice: { patient: patientSearchWhere(q) } }];
  if (status && CLAIM_STATUSES.includes(status)) where.status = status;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dayRangeUtc(from, tz)[0];
    if (to) where.createdAt.lt = dayRangeUtc(to, tz)[1];
  }
  const [total, rows] = await Promise.all([
    prisma.insuranceClaim.count({ where }),
    prisma.insuranceClaim.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
      include: {
        policy: { select: { policyNumber: true, provider: { select: { name: true } } } },
        invoice: { select: { id: true, invoiceNo: true, total: true, patient: { select: { id: true, mrn: true, firstName: true, lastName: true } } } },
      },
    }),
  ]);
  return { rows, meta: pageMeta(total, page, pageSize) };
}

export async function getClaimsSummary() {
  const g = await prisma.insuranceClaim.groupBy({ by: ["status"], _count: true, _sum: { claimAmount: true, approvedAmount: true } });
  const by = Object.fromEntries(g.map((r) => [r.status, r]));
  const s = (st, f) => toMoneyString(by[st]?._sum?.[f] ?? 0);
  const c = (st) => by[st]?._count ?? 0;
  return {
    submitted: { count: c("SUBMITTED"), amount: s("SUBMITTED", "claimAmount") },
    approved: { count: c("APPROVED") + c("PARTIALLY_APPROVED"), amount: toMoneyString(D(s("APPROVED", "approvedAmount")).plus(s("PARTIALLY_APPROVED", "approvedAmount"))) },
    rejected: { count: c("REJECTED"), amount: s("REJECTED", "claimAmount") },
    paid: { count: c("PAID"), amount: s("PAID", "approvedAmount") },
  };
}

/** Invoice + active policies of the same patient covering the invoice date, and how much can still be claimed. */
export async function getClaimEligibility(invoiceId, tz) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNo: true, status: true, total: true, balance: true, issuedAt: true, createdAt: true, patientId: true, patient: { select: { mrn: true, firstName: true, lastName: true } }, claims: { select: { status: true, claimAmount: true } } },
  });
  if (!inv) throw notFound("Invoice not found");
  const date = toZonedDateString(inv.issuedAt ?? inv.createdAt, tz);
  const policies = await prisma.insurancePolicy.findMany({
    where: { patientId: inv.patientId, isActive: true, provider: { isActive: true } },
    include: { provider: { select: { name: true } } }, orderBy: { coverageEnd: "desc" },
  });
  const remaining = claimableRemaining(inv.total, inv.claims.filter((c) => OPEN_CLAIM_STATUSES.includes(c.status)).map((c) => c.claimAmount));
  return {
    invoice: { id: inv.id, invoiceNo: inv.invoiceNo, status: inv.status, total: inv.total, balance: inv.balance, date, patient: inv.patient },
    claimable: CLAIMABLE_INVOICE.includes(inv.status),
    remaining,
    policies: policies.filter((p) => policyCoversDate(p, date)).map((p) => ({ id: p.id, policyNumber: p.policyNumber, provider: p.provider.name, coverageStart: p.coverageStart, coverageEnd: p.coverageEnd })),
  };
}

export async function createClaim({ invoiceId, policyId, claimAmount }, session, ip) {
  const { timezone } = await getHospital();
  return prisma.$transaction(async (tx) => {
    // Lock the invoice so concurrent claims cannot together exceed its total.
    const locked = await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    if (!locked.length) throw notFound("Invoice not found");
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { claims: { select: { status: true, claimAmount: true } } } });
    if (!CLAIMABLE_INVOICE.includes(inv.status)) throw invalidState("Claims can only be raised on issued, partially paid or paid invoices.");
    const policy = await tx.insurancePolicy.findUnique({ where: { id: policyId }, include: { provider: { select: { isActive: true } } } });
    if (!policy || policy.patientId !== inv.patientId) throw notFound("Policy not found for this patient");
    if (!policy.isActive || !policy.provider.isActive) throw invalidState("The policy or its provider is inactive.");
    const date = toZonedDateString(inv.issuedAt ?? inv.createdAt, timezone);
    if (!policyCoversDate(policy, date)) throw invalidState("The policy does not cover the invoice date.");
    if (D(claimAmount).gt(D(inv.total))) throw invalidState("Claim amount cannot exceed the invoice total.");
    const remaining = claimableRemaining(inv.total, inv.claims.filter((c) => OPEN_CLAIM_STATUSES.includes(c.status)).map((c) => c.claimAmount));
    if (D(claimAmount).gt(D(remaining))) throw invalidState(`Other claims already cover part of this invoice. At most ${remaining} can still be claimed.`);
    const claim = await tx.insuranceClaim.create({
      data: { claimNo: await newId(tx, "claim"), policyId, invoiceId, claimAmount: toMoneyString(claimAmount), status: "SUBMITTED", submittedAt: new Date() },
    });
    await audit({ userId: session.user.id, action: "claim.create", entityType: "InsuranceClaim", entityId: claim.id, metadata: { claimNo: claim.claimNo, invoiceId, policyId, claimAmount: claim.claimAmount.toString() }, ipAddress: ip }, tx);
    return claim;
  }, TX);
}

export async function getClaimDetail(id) {
  const c = await prisma.insuranceClaim.findUnique({
    where: { id },
    include: {
      policy: { include: { provider: true } },
      invoice: { include: { patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phone: true } }, payments: { where: { method: INSURANCE_METHOD }, orderBy: { receivedAt: "asc" } } } },
    },
  });
  if (!c) return null;
  const [documents, settlement] = await Promise.all([
    prisma.uploadedDocument.findMany({ where: { patientId: c.invoice.patientId, category: "INSURANCE" }, orderBy: { createdAt: "desc" }, select: { id: true, originalName: true, sizeBytes: true, mimeType: true, createdAt: true } }),
    prisma.payment.findUnique({ where: { idempotencyKey: `claim:${c.id}` } }),
  ]);
  return { ...c, documents, settlement };
}

/**
 * Records an insurer decision. Marking PAID posts an INSURANCE payment on the invoice (approved amount capped at
 * the outstanding balance) through the shared billing payment function, in the same transaction.
 */
export async function updateClaimStatus(id, input, session, ip) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.insuranceClaim.findUnique({ where: { id }, include: { invoice: { select: { id: true } } } });
    if (!claim) throw notFound("Claim not found");
    const decision = resolveClaimDecision(claim, input);
    if (decision.error) throw invalidState(decision.error);
    let payment = null, capped = false;
    if (input.status === "PAID") {
      const rows = await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${claim.invoiceId} FOR UPDATE`;
      if (!rows.length) throw notFound("Invoice not found");
      const inv = await tx.invoice.findUnique({ where: { id: claim.invoiceId } });
      const amount = insuranceSettlementAmount(decision.approvedAmount, inv.balance);
      if (D(amount).lte(0)) throw invalidState("The invoice has no outstanding balance to settle. If the patient already paid, refund the patient first, then mark the claim paid.");
      capped = D(amount).lt(D(decision.approvedAmount));
      const res = await applyPayment(tx, claim.invoiceId, {
        amount, method: INSURANCE_METHOD, reference: [`Claim ${claim.claimNo}`, input.reference].filter(Boolean).join(" / ").slice(0, 120), idempotencyKey: `claim:${claim.id}`,
      }, session, ip, { allowInsurance: true });
      payment = res.payment;
    }
    const data = { status: input.status };
    if (input.status !== "PAID") {
      data.approvedAmount = decision.approvedAmount;
      data.rejectionReason = input.status === "REJECTED" ? input.rejectionReason.trim() : null;
    }
    const r = await tx.insuranceClaim.updateMany({ where: { id, status: claim.status }, data });
    if (!r.count) throw conflict("The claim was updated by someone else. Refresh and try again.");
    await audit({
      userId: session.user.id, action: "claim.status", entityType: "InsuranceClaim", entityId: id,
      metadata: { claimNo: claim.claimNo, from: claim.status, to: input.status, approvedAmount: decision.approvedAmount, paymentId: payment?.id ?? null, settledAmount: payment ? payment.amount.toString() : null, capped, rejectionReason: input.status === "REJECTED" ? input.rejectionReason : undefined },
      ipAddress: ip,
    }, tx);
    return { claim: await tx.insuranceClaim.findUnique({ where: { id } }), payment };
  }, TX);
}
