import { z } from "zod";
import { D, toMoneyString } from "../utils/money.js";
import { requiredText, optionalText, phone, email, dateString, money, listQuery } from "./common.js";

export const CLAIM_STATUSES = ["SUBMITTED", "APPROVED", "PARTIALLY_APPROVED", "REJECTED", "PAID"];

/** Allowed claim transitions. PAID and REJECTED are terminal. */
export const CLAIM_TRANSITIONS = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "PARTIALLY_APPROVED", "REJECTED"],
  APPROVED: ["PAID"],
  PARTIALLY_APPROVED: ["PAID"],
  REJECTED: [],
  PAID: [],
};

export function canTransitionClaim(from, to) {
  return (CLAIM_TRANSITIONS[from] || []).includes(to);
}

/** Claims in these states still "hold" part of the invoice (count toward the claimable total, block voiding). */
export const OPEN_CLAIM_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_APPROVED", "PAID"];

export const providerSchema = z.object({
  name: requiredText(120, "Name"),
  phone,
  email,
  isActive: z.boolean().optional().default(true),
});

export const providerActiveSchema = z.object({ isActive: z.boolean() });

export const policySchema = z.object({
  patientId: z.string({ error: "Choose a patient" }).min(1, "Choose a patient").max(64),
  providerId: z.string({ error: "Choose a provider" }).min(1, "Choose a provider").max(64),
  policyNumber: requiredText(60, "Policy number"),
  coverageStart: dateString,
  coverageEnd: dateString,
  coverageNotes: optionalText(500),
  isActive: z.boolean().optional().default(true),
}).refine((v) => v.coverageEnd >= v.coverageStart, { message: "Coverage end must be on or after the start date", path: ["coverageEnd"] });

export const claimCreateSchema = z.object({
  invoiceId: z.string({ error: "Choose an invoice" }).min(1, "Choose an invoice").max(64),
  policyId: z.string({ error: "Choose a policy" }).min(1, "Choose a policy").max(64),
  claimAmount: money.refine((v) => D(v).gt(0), "Claim amount must be greater than zero"),
});

export const claimStatusSchema = z.object({
  status: z.enum(["APPROVED", "PARTIALLY_APPROVED", "REJECTED", "PAID"]),
  approvedAmount: money.optional(),
  rejectionReason: optionalText(500),
  reference: optionalText(120),
});

export const claimListQuery = listQuery;
export const policyListQuery = listQuery.extend({ providerId: z.string().max(64).optional(), patientId: z.string().max(64).optional(), activeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * Validates an insurer decision. Returns { error } or { approvedAmount } (string, 2dp, or null for rejections).
 */
export function resolveClaimDecision(claim, { status, approvedAmount, rejectionReason }) {
  if (!canTransitionClaim(claim.status, status)) return { error: `A ${claim.status.toLowerCase().replace(/_/g, " ")} claim cannot be marked ${status.toLowerCase().replace(/_/g, " ")}.` };
  const claimed = D(claim.claimAmount);
  if (status === "APPROVED") {
    const amt = approvedAmount != null && approvedAmount !== "" ? D(approvedAmount) : claimed;
    if (!amt.eq(claimed)) return { error: "For a full approval the approved amount equals the claim amount. Use partial approval otherwise." };
    return { approvedAmount: toMoneyString(amt) };
  }
  if (status === "PARTIALLY_APPROVED") {
    if (approvedAmount == null || approvedAmount === "") return { error: "Enter the approved amount." };
    const amt = D(approvedAmount);
    if (amt.lte(0) || amt.gte(claimed)) return { error: "Partially approved amount must be more than zero and less than the claim amount." };
    return { approvedAmount: toMoneyString(amt) };
  }
  if (status === "REJECTED") {
    if (!rejectionReason || rejectionReason.trim().length < 3) return { error: "Give the rejection reason." };
    return { approvedAmount: null };
  }
  // PAID
  if (claim.approvedAmount == null || D(claim.approvedAmount).lte(0)) return { error: "Claim has no approved amount." };
  return { approvedAmount: toMoneyString(claim.approvedAmount) };
}

/** Amount that will be posted to the invoice when an approved claim is paid: approved amount capped at the outstanding balance. */
export function insuranceSettlementAmount(approvedAmount, invoiceBalance) {
  const a = D(approvedAmount), b = D(invoiceBalance);
  const v = a.lt(b) ? a : b;
  return toMoneyString(v.isNegative() ? 0 : v);
}

/** True when an @db.Date coverage window (UTC-midnight dates) includes the local date string "YYYY-MM-DD". */
export function policyCoversDate(policy, dateStr) {
  const s = new Date(policy.coverageStart).toISOString().slice(0, 10);
  const e = new Date(policy.coverageEnd).toISOString().slice(0, 10);
  return s <= dateStr && dateStr <= e;
}

/** Remaining claimable amount for an invoice given its other open claims. */
export function claimableRemaining(invoiceTotal, openClaimAmounts = []) {
  const used = openClaimAmounts.reduce((s, a) => s.plus(D(a)), D(0));
  const r = D(invoiceTotal).minus(used);
  return toMoneyString(r.isNegative() ? 0 : r);
}
