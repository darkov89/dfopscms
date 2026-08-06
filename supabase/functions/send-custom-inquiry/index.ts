// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyTurnstileToken } from "../_shared/turnstileVerification.ts";
import { buildCorsHeadersForRequest } from "../_shared/allowedOrigins.ts";
import {
  defaultInquiryFromAddress,
  defaultInquiryToAddress,
  sendTransactionalEmail,
} from "../_shared/sendTransactionalEmail.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_HITS = 5;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function buildCorsHeaders(req: Request) {
  return buildCorsHeadersForRequest(req, corsHeaders);
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_HITS;
}

function str(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (!cors) {
    return new Response(JSON.stringify({ error: "CORS: origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const ip = clientIp(req);
    if (isRateLimited(`inq:${ip}`)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const turnstile = await verifyTurnstileToken(
      typeof body?.turnstileToken === "string" ? body.turnstileToken : "",
      req.headers.get("CF-Connecting-IP") || ip,
    );
    if (!turnstile.success) {
      return new Response(JSON.stringify({ error: "Turnstile verification failed" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const name = str(body?.name, 120);
    const email = str(body?.email, 200).toLowerCase();
    const company = str(body?.company, 160);
    const message = str(body?.message, 4000);

    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const to = defaultInquiryToAddress();
    const from = defaultInquiryFromAddress();
    const subject = "DFCMS — zapytanie o pakiet Custom";
    const lines = [
      "Nowe zapytanie o pakiet Custom (dfcms.pl)",
      "",
      `Imię i nazwisko: ${name}`,
      `E-mail: ${email}`,
    ];
    if (company) lines.push(`Firma: ${company}`);
    lines.push("", "---", message, "", `IP: ${ip}`);

    const text = lines.join("\n");
    const html = `
      <p><strong>Nowe zapytanie o pakiet Custom</strong> (dfcms.pl)</p>
      <ul>
        <li><strong>Imię i nazwisko:</strong> ${escapeHtml(name)}</li>
        <li><strong>E-mail:</strong> ${escapeHtml(email)}</li>
        ${company ? `<li><strong>Firma:</strong> ${escapeHtml(company)}</li>` : ""}
      </ul>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
    `.trim();

    const sent = await sendTransactionalEmail({
      to,
      from,
      replyTo: email,
      subject,
      text,
      html,
    });

    // Ops channel (already configured) — so inquiry is never lost if SMTP/Resend secrets are missing.
    let telegramOk = false;
    try {
      const token = (Deno.env.get("TELEGRAM_BOT_TOKEN") || "").trim();
      const chatId = (Deno.env.get("TELEGRAM_CHAT_ID") || "").trim();
      if (token && chatId) {
        const tg = [
          "📩 <b>DFCMS — zapytanie Custom</b>",
          `<b>Imię:</b> ${escapeHtml(name)}`,
          `<b>E-mail:</b> ${escapeHtml(email)}`,
          company ? `<b>Firma:</b> ${escapeHtml(company)}` : "",
          "",
          escapeHtml(message.slice(0, 2800)),
        ]
          .filter(Boolean)
          .join("\n");
        const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: tg,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        });
        telegramOk = tgRes.ok;
        if (!tgRes.ok) {
          const body = await tgRes.text().catch(() => "");
          console.error("[send-custom-inquiry] telegram", tgRes.status, body.slice(0, 200));
        }
      }
    } catch (tgErr) {
      console.error("[send-custom-inquiry] telegram", tgErr);
    }

    if (!sent.ok && !telegramOk) {
      console.error("[send-custom-inquiry]", sent.error);
      return new Response(
        JSON.stringify({
          error: "Email delivery is not configured",
          detail: sent.error,
        }),
        {
          status: 503,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        email: sent.ok,
        provider: sent.ok ? sent.provider : null,
        telegram: telegramOk,
      }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[send-custom-inquiry]", msg);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
