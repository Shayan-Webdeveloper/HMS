import { z } from "zod";
import { id, requiredText, optionalText, phone, email, dateString } from "./common.js";

// Patient-portal inputs. None of these accept a patientId — the server always
// uses the signed-in patient's own record.

export const appointmentRequestSchema = z.object({
  doctorId: id.refine((v) => v.length > 0, "Choose a doctor"),
  preferredDate: dateString,
  reason: requiredText(300, "Reason for visit"),
});

export const portalCancelSchema = z.object({
  reason: requiredText(300, "Reason").refine((v) => v.length >= 3, "Please give a reason (min 3 characters)"),
});

export const portalProfileSchema = z.object({
  phone,
  email,
  address: optionalText(300),
  city: optionalText(80),
  consentToSms: z.boolean().optional().default(false),
  consentToEmail: z.boolean().optional().default(false),
});
