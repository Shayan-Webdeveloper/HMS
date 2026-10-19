import { z } from "zod";

// Shared schema helpers (plain JS, Zod v4).
export const id = z.string().min(1).max(64);
export const optionalText = (max = 2000) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
export const requiredText = (max = 200, label = "This field") => z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "Use a valid date");
export const optionalDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), dateString.optional());
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const phone = z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().regex(/^[+0-9()\-\s]{7,20}$/, "Enter a valid phone number").optional());
export const email = z.preprocess((v) => (v === "" ? undefined : v), z.email("Enter a valid email").max(200).optional());
export const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), "Enter a valid amount (max 2 decimals)");
export const positiveInt = z.coerce.number().int().positive();

export const listQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
  sort: z.string().max(40).optional(),
  dir: z.enum(["asc", "desc"]).optional().default("desc"),
  status: z.string().max(40).optional(),
  from: optionalDate,
  to: optionalDate,
});

export function pageMeta(total, page, pageSize) {
  return { total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
