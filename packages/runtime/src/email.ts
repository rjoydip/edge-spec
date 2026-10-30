/**
 * Email. One port, one driver: Resend's HTTP API, because it is a plain fetch
 * and works from every target. The API key travels the same way as the AI and
 * sandbox keys — a request header set by the visitor's own settings — so the
 * deployment stores none of it (invariant 1).
 */
import type { Env } from "./env";
import type { EmailSender } from "./ports";

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailConfig {
  key: string;
  from: string;
}

/** The visitor's settings carry the sender; env is the deployment fallback. */
export function emailConfigOf(env: Env, headers?: Headers): EmailConfig | undefined {
  const key = headers?.get("x-email-key")?.trim() || env.EMAIL_API_KEY?.trim();
  const from =
    headers?.get("x-email-from")?.trim() ||
    env.EMAIL_FROM?.trim() ||
    (key ? "EdgeSpec <noreply@edgespec.dev>" : undefined);
  return key && from ? { key, from } : undefined;
}

export type EmailResult = { sent: true } | { sent: false; reason: string };

/**
 * The `EmailSender` port for one configuration. Resend is plain HTTP, so the
 * same adapter serves every target; per-request keys stay in `emailConfigOf`.
 */
export const emailSender = (config: EmailConfig | undefined): EmailSender => ({
  send: (input) => sendEmail(config, input),
});

/** Sends via Resend; a missing config answers "not sent", never throws. */
export async function sendEmail(
  config: EmailConfig | undefined,
  input: EmailInput,
): Promise<EmailResult> {
  if (!config) return { sent: false, reason: "No email sender is configured." };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
    }),
  });
  if (response.ok) return { sent: true };
  const detail = await response.text().catch(() => "");
  return {
    sent: false,
    reason: `Resend rejected the email (${response.status}). ${detail.slice(0, 200)}`,
  };
}

// ---------------------------------------------------------------------------
// Minimal transactional templates. Plain HTML, no images, no tracking.

const shell = (title: string, body: string): string => `
<p style="margin:0 0 16px;font-size:16px;">${title}</p>
${body}
<p style="margin:16px 0;color:#71717a;font-size:12px;">
  Sent by your EdgeSpec deployment. If you did not expect this, ignore the
  email and the tokens inside expire on their own.
</p>`;

const action = (url: string, label: string): string => `
<p style="margin:0 0 16px;">
  <a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;
  background:#18181b;color:#fff;text-decoration:none;font-size:14px;">${label}</a>
</p>`;

export function verifyEmailHtml(url: string): string {
  return shell(
    "Confirm your email",
    `${action(url, "Confirm email")}
<p style="margin:0;font-size:13px;color:#52525b;">Or open this link:
<code>${url}</code></p>`,
  );
}

export function resetPasswordHtml(url: string): string {
  return shell(
    "Reset your password",
    `${action(url, "Choose a new password")}
<p style="margin:0;font-size:13px;color:#52525b;">Or open this link:
<code>${url}</code></p>`,
  );
}
