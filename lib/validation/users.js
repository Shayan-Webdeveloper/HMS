import { z } from "zod";
import { requiredText, optionalText } from "./common.js";

export const ROLE_KEY = z.string().trim().regex(/^[A-Z][A-Z_]{1,39}$/, "Invalid role");

const roleList = z.array(ROLE_KEY).min(1, "Choose at least one role").max(12)
  .refine((a) => new Set(a).size === a.length, "Duplicate role");

export const createUserSchema = z.object({
  name: requiredText(120, "Name"),
  email: z.email("Enter a valid email").trim().toLowerCase().max(200),
  roles: roleList,
  // Optional: link a PATIENT account to a patient record at creation time (by MRN).
  patientMrn: optionalText(30),
});

export const updateUserSchema = z.object({
  name: requiredText(120, "Name").optional(),
  roles: roleList.optional(),
}).refine((v) => v.name !== undefined || v.roles !== undefined, "Nothing to update");

export const userStatusSchema = z.object({
  active: z.boolean(),
  reason: optionalText(300),
});

export const patientLinkSchema = z.object({
  mrn: requiredText(30, "MRN").transform((v) => v.toUpperCase()),
});

export const rolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().regex(/^[a-z_]+:[a-z_]+$/, "Invalid permission key")).max(200)
    .refine((a) => new Set(a).size === a.length, "Duplicate permission"),
});

export const userListQuery = z.object({
  q: z.string().trim().max(100).optional().default(""),
  role: z.preprocess((v) => (v === "" ? undefined : v), ROLE_KEY.optional()),
  status: z.enum(["active", "inactive", ""]).optional().default(""),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
});
