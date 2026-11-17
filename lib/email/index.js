import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

// Provider abstraction. "log" (default) writes messages to storage/mail-log for development;
// "smtp" uses nodemailer with EMAIL_SERVER_* variables. Subjects must never contain clinical details.
export async function sendEmail({ to, subject, text }) {
  const provider = process.env.EMAIL_PROVIDER || "log";
  const from = process.env.EMAIL_FROM || "Hospital <no-reply@example.com>";
  if (!to) return { delivered: false, reason: "no-recipient" };
  if (provider === "smtp") {
    if (!process.env.EMAIL_SERVER_HOST) return { delivered: false, reason: "smtp-not-configured" };
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER_HOST,
      port: Number(process.env.EMAIL_SERVER_PORT || 587),
      auth: process.env.EMAIL_SERVER_USER ? { user: process.env.EMAIL_SERVER_USER, pass: process.env.EMAIL_SERVER_PASSWORD } : undefined,
    });
    try {
      await transport.sendMail({ from, to, subject, text });
      return { delivered: true };
    } catch (e) {
      console.error("[email] send failed:", e?.code || e?.message);
      return { delivered: false, reason: "smtp-error" };
    }
  }
  // "log" provider. In production (and on serverless hosts, whose file system is read-only) nothing is
  // written or printed: messages can contain one-time links, which must not end up in logs.
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    console.warn("[email] EMAIL_PROVIDER=log — message not delivered (configure SMTP to send email).");
    return { delivered: false, reason: "log-provider" };
  }
  const dir = path.join(process.cwd(), "storage", "mail-log");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  await fs.writeFile(file, `From: ${from}\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
  if (process.env.NODE_ENV !== "production") console.info(`[email:log] "${subject}" → ${to} (saved to ${path.relative(process.cwd(), file)})`);
  return { delivered: false, logged: true };
}
