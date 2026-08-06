/**
 * Transactional email for Edge Functions via custom SMTP
 * (same credentials as Supabase Auth → SMTP — avoid Resend/Auth rate limits).
 */

declare const Deno: { env: { get: (k: string) => string | undefined } };

export type TransactionalEmailPayload = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendEmailResult = { ok: true; provider: "smtp" } | {
  ok: false;
  error: string;
};

function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

export async function sendTransactionalEmail(
  payload: TransactionalEmailPayload,
): Promise<SendEmailResult> {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) {
    return {
      ok: false,
      error: "SMTP_HOST / SMTP_USER / SMTP_PASS not configured (mirror Auth → SMTP)",
    };
  }

  const port = Number(env("SMTP_PORT") || "465") || 465;
  const secureEnv = env("SMTP_SECURE");
  const secure = secureEnv
    ? secureEnv === "1" || secureEnv.toLowerCase() === "true"
    : port === 465;

  const nodemailer = await import("npm:nodemailer@6.9.16");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from: payload.from,
      to: payload.to,
      replyTo: payload.replyTo,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    return { ok: true, provider: "smtp" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "SMTP send failed" };
  }
}

export function defaultInquiryFromAddress(): string {
  return env("INQUIRY_FROM_EMAIL") || env("SMTP_FROM") || "DFCMS <notifications@dfops.eu>";
}

export function defaultInquiryToAddress(): string {
  return env("INQUIRY_TO_EMAIL") || "kontakt@dfops.eu";
}
