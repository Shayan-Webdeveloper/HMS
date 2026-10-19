import { z } from "zod";
import { requiredText, optionalText, optionalDate, phone, email } from "./common.js";

export const SEX = ["MALE", "FEMALE", "OTHER", "UNKNOWN"];
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const patientSchema = z.object({
  firstName: requiredText(80, "First name"),
  lastName: requiredText(80, "Last name"),
  dateOfBirth: optionalDate.refine((v) => !v || new Date(v) <= new Date(), "Date of birth cannot be in the future"),
  sex: z.enum(SEX).default("UNKNOWN"),
  phone,
  email,
  address: optionalText(300),
  city: optionalText(80),
  bloodGroup: z.preprocess((v) => (v === "" ? undefined : v), z.enum(BLOOD_GROUPS).optional()),
  medicalAlerts: optionalText(500),
  consentToSms: z.boolean().optional().default(false),
  consentToEmail: z.boolean().optional().default(false),
  emergencyContactName: optionalText(120),
  emergencyContactRelationship: optionalText(60),
  emergencyContactPhone: phone,
  confirmDuplicate: z.boolean().optional(),
});

export const allergySchema = z.object({
  substance: requiredText(120, "Substance"),
  reaction: optionalText(200),
  severity: z.enum(["MILD", "MODERATE", "SEVERE", "UNKNOWN"]).default("UNKNOWN"),
});

export const historySchema = z.object({
  category: z.enum(["PAST_ILLNESS", "SURGICAL", "FAMILY", "SOCIAL", "IMMUNIZATION"]),
  description: requiredText(500, "Description"),
  onsetDate: optionalDate,
});
