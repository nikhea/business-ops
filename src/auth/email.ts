/**
 * Auth emails.
 *
 * Resend is already a dependency for the Resend tools. When RESEND_API_KEY is
 * missing we print the link to the server log in development so the invite and
 * reset flows stay usable locally, and fail loudly in production.
 */

import { Resend } from "resend";

const DEFAULT_FROM = "Business Ops <onboarding@resend.dev>";

let client: Resend | undefined;

function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not set, so auth email cannot be sent.");
  if (!client) client = new Resend(apiKey);
  return client;
}

function fromAddress(): string {
  return process.env.AUTH_EMAIL_FROM?.trim() || DEFAULT_FROM;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailShell(title: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1.5rem; color: #1f2937; line-height: 1.6;">
    <h1 style="font-size: 1.25rem;">${escapeHtml(title)}</h1>
    ${body}
    <p style="margin-top: 2rem; font-size: 0.8125rem; color: #6b7280;">
      If you were not expecting this email, you can ignore it.
    </p>
  </body>
</html>`;
}

async function deliver(options: {
  to: string;
  subject: string;
  html: string;
  fallbackUrl: string;
  logLabel: string;
}): Promise<void> {
  const { to, subject, html, fallbackUrl, logLabel } = options;

  if (!process.env.RESEND_API_KEY?.trim()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set, so auth email cannot be sent in production.");
    }

    console.warn(
      `[auth] RESEND_API_KEY is not set. ${logLabel} for ${to}:\n  ${fallbackUrl}`,
    );
    return;
  }

  const result = await getResend().emails.send({
    from: fromAddress(),
    to,
    subject,
    html,
  });

  if (result.error) {
    throw new Error(`Could not send ${logLabel.toLowerCase()}: ${result.error.message}`);
  }
}

export async function sendPasswordResetEmail(options: {
  email: string;
  name?: string | null;
  url: string;
}): Promise<void> {
  const { email, name, url } = options;
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";

  await deliver({
    to: email,
    subject: "Set your Business Ops password",
    logLabel: "Password link",
    fallbackUrl: url,
    html: emailShell(
      "Set your password",
      `<p>${greeting}</p>
       <p>An account has been created for you on Business Ops. Use the button below to choose your password.</p>
       <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:0.6rem 1rem;border-radius:0.375rem;text-decoration:none;">Set password</a></p>
       <p style="font-size:0.8125rem;color:#6b7280;">This link expires in one hour. If it has expired, ask an admin to send a new one.</p>`,
    ),
  });
}
