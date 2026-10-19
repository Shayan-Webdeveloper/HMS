import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase().max(200),
  password: z.string().min(1, "Password is required").max(128),
});
export const forgotSchema = z.object({ email: z.email("Enter a valid email").trim().toLowerCase().max(200) });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(128) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, "Current password is required"), newPassword: z.string().min(1).max(128) });
