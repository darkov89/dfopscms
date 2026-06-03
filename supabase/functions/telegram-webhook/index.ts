// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(s: string, max = 3500) {
  const str = String(s || "");
  if (str.length <= max) return str;
  return str.slice(0, Math.max(0, max - 12)) + "\n…(truncated)";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function getString(o: Record<string, unknown>, k: string) {
  const v = o[k];
  return typeof v === "string" ? v : "";
}

function levelEmoji(level: string) {
  const l = (level || "").toLowerCase();
  if (l === "fatal" || l === "critical") return "💥";
  if (l === "error") return "🚨";
  if (l === "warning") return "⚠️";
  return "ℹ️";
}

function buildMessageFromSentry(payload: Record<string, unknown>) {
  const project = getString(payload, "project");
  const level = getString(payload, "level") || getString(payload, "severity");
  const message = getString(payload, "message") || getString(payload, "title");
  const culprit = getString(payload, "culprit");
  const url = getString(payload, "url") || getString(payload, "web_url");

  const looksLikeSentry = !!(project || level || message || culprit || url);
  if (!looksLikeSentry) return null;

  const head = `${levelEmoji(level)} <b>Sentry alert</b>`;
  const lines: string[] = [head];
  if (project) lines.push(`<b>Project</b>: ${escapeHtml(project)}`);
  if (level) lines.push(`<b>Level</b>: ${escapeHtml(level)}`);
  if (message) lines.push(`<b>Message</b>: ${escapeHtml(truncate(message, 900))}`);
  if (culprit) lines.push(`<b>Culprit</b>: ${escapeHtml(truncate(culprit, 900))}`);
  if (url) lines.push(`<b>URL</b>: ${escapeHtml(url)}`);
  return lines.join("\n");
}

const DB_EVENT_TYPES = new Set(["INSERT", "UPDATE", "DELETE"]);

function isDatabaseWebhook(payload: Record<string, unknown>): boolean {
  const type = getString(payload, "type");
  const table = getString(payload, "table");
  const schema = getString(payload, "schema");
  if (!DB_EVENT_TYPES.has(type) || !table || !schema) return false;
  const record = payload.record;
  const oldRecord = payload.old_record;
  const recordOk = record == null || isObject(record);
  const oldOk =
    oldRecord == null || oldRecord === undefined || isObject(oldRecord);
  return recordOk && oldOk;
}

function recordForDbEvent(
  type: string,
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  if (type === "DELETE") {
    const old = payload.old_record;
    return isObject(old) ? old : null;
  }
  const rec = payload.record;
  return isObject(rec) ? rec : null;
}

/** ID, email, user_id, slug — cokolwiek jest w wierszu. */
function appendRecordContext(
  lines: string[],
  rec: Record<string, unknown> | null,
) {
  if (!rec) return;
  const id = rec.id;
  if (typeof id === "string" && id) {
    lines.push(`ID: <code>${escapeHtml(id)}</code>`);
  }
  const email = rec.email;
  if (typeof email === "string" && email) {
    lines.push(`Email: <code>${escapeHtml(email)}</code>`);
  }
  const userId = rec.user_id;
  if (typeof userId === "string" && userId && userId !== id) {
    lines.push(`User ID: <code>${escapeHtml(userId)}</code>`);
  }
  const slug = rec.slug;
  if (typeof slug === "string" && slug) {
    lines.push(`Slug: <code>${escapeHtml(slug)}</code>`);
  }
}

function buildMessageFromDatabaseWebhook(payload: Record<string, unknown>) {
  if (!isDatabaseWebhook(payload)) return null;

  const type = getString(payload, "type");
  const table = getString(payload, "table");
  const schema = getString(payload, "schema");
  const rec = recordForDbEvent(type, payload);

  let headline: string | null = null;

  if (table === "users" && type === "INSERT") {
    headline = "🎉 <b>Nowy użytkownik!</b> Ktoś właśnie założył konto.";
  } else if (table === "users" && type === "DELETE") {
    headline = "⚠️ <b>Usunięto konto!</b> Użytkownik skasował profil.";
  } else if (table === "pages" && type === "INSERT") {
    headline = "📄 <b>Nowa strona!</b> Klient opublikował nową stronę.";
  } else if (table === "pages" && type === "DELETE") {
    headline = "🗑️ <b>Usunięto stronę.</b>";
  } else if (table === "billing_profiles" && type === "UPDATE") {
    headline = "💳 <b>Zmiana w płatnościach!</b> Profil bilingowy zaktualizowany.";
  }

  if (!headline) return null;

  const lines: string[] = [
    headline,
    `<i>${escapeHtml(schema)}.${escapeHtml(table)} · ${escapeHtml(type)}</i>`,
  ];
  appendRecordContext(lines, rec);
  return lines.join("\n");
}

function routeWebhookMessage(payload: Record<string, unknown>): string {
  const msgSentry = buildMessageFromSentry(payload);
  if (msgSentry) return msgSentry;

  const msgDb = buildMessageFromDatabaseWebhook(payload);
  if (msgDb) return msgDb;

  const msgSb = buildMessageFromSupabaseAlert(payload);
  if (msgSb) return msgSb;

  return `🚨 <b>Nieznany alert z Webhooka</b>\n<pre>${escapeHtml(truncate(JSON.stringify(payload, null, 2)))}</pre>`;
}

function buildMessageFromSupabaseAlert(payload: Record<string, unknown>) {
  // Supabase alerts/logs can vary; try a few likely keys and fall back.
  const title =
    getString(payload, "title") ||
    getString(payload, "name") ||
    getString(payload, "summary");
  const severity =
    getString(payload, "severity") ||
    getString(payload, "level") ||
    getString(payload, "status");
  const description =
    getString(payload, "description") ||
    getString(payload, "message") ||
    getString(payload, "details");

  const hasAny = !!(title || severity || description);
  if (!hasAny) return null;

  const head = `${levelEmoji(severity)} <b>Supabase alert</b>`;
  const lines: string[] = [head];
  if (title) lines.push(`<b>Title</b>: ${escapeHtml(truncate(title, 900))}`);
  if (severity) lines.push(`<b>Severity</b>: ${escapeHtml(severity)}`);
  if (description) {
    lines.push(`<b>Message</b>: ${escapeHtml(truncate(description, 1200))}`);
  }

  // If there's a nested payload, include minimal hint.
  const metaKeys = ["project_ref", "ref", "region", "function", "endpoint"];
  for (const k of metaKeys) {
    const v = getString(payload, k);
    if (v) lines.push(`<b>${escapeHtml(k)}</b>: ${escapeHtml(truncate(v, 400))}`);
  }

  return lines.join("\n");
}

async function sendTelegram(text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
  if (!token || !chatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram API error: ${res.status} ${res.statusText} ${body}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }

  const payload: Record<string, unknown> = isObject(raw)
    ? raw
    : { raw: raw ?? "non_json_body" };

  try {
    await sendTelegram(routeWebhookMessage(payload));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    // Best-effort fallback: try to send error too.
    try {
      await sendTelegram(
        `🚨 <b>telegram-webhook failure</b>\n<pre>${escapeHtml(truncate(errMsg, 1800))}</pre>\n<pre>${escapeHtml(truncate(JSON.stringify(payload, null, 2)))}</pre>`,
      );
    } catch {
      // ignore
    }
    return new Response(JSON.stringify({ ok: false, error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

