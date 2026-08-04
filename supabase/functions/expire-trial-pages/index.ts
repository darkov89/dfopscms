// @ts-ignore - remote Deno std module
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

type RpcResult = { count?: number; slugs?: string[] };

type PurgePageRow = {
  slug?: string;
  trial_blocked_at?: string;
  purge_scheduled_at?: string;
  days_blocked?: number;
};

type PurgeRpcResult = {
  count?: number;
  pages?: PurgePageRow[];
};

function parseRpcPayload(data: unknown): RpcResult {
  if (data == null) return { count: 0, slugs: [] };
  if (typeof data === "number") return { count: data, slugs: [] };
  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    const count = typeof o.count === "number" ? o.count : 0;
    const slugs = Array.isArray(o.slugs) ? o.slugs.map((x) => String(x)) : [];
    return { count, slugs };
  }
  return { count: 0, slugs: [] };
}

function parsePurgeRpc(data: unknown): PurgeRpcResult {
  if (data == null || typeof data !== "object") return { count: 0, pages: [] };
  const o = data as Record<string, unknown>;
  const count = typeof o.count === "number" ? o.count : 0;
  const pages = Array.isArray(o.pages) ? (o.pages as PurgePageRow[]) : [];
  return { count, pages };
}

function envTruthy(key: string): boolean {
  const v = (Deno.env.get(key) ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Bezpieczny slug w backtickach (Markdown). */
function mdSlug(slug: string): string {
  return slug.replace(/`/g, "'");
}

function buildPurgeWarningMessage(slug: string): string {
  return (
    "⚠️ *DFCMS: Ostrzeżenie o kasacji*\n" +
    `Strona \`${mdSlug(slug)}\` zostanie usunięta za 7 dni z powodu braku płatności.`
  );
}

function buildManualPurgeReportMessage(slugs: string[]): string {
  const inList = slugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(", ");
  return (
    "🚨 *DFCMS: Strony do ręcznej kasacji (30+ dni)*\n" +
    "Uruchom SQL, aby wyczyścić:\n" +
    `\`DELETE FROM pages WHERE slug IN (${inList});\``
  );
}

async function sendTelegramMessage(text: string): Promise<boolean> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim() ?? "";
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")?.trim() ?? "";
  if (!botToken || !chatId) {
    console.warn("Telegram: brak TELEGRAM_BOT_TOKEN lub TELEGRAM_CHAT_ID — pominięto wysyłkę");
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.warn("Telegram API", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("Telegram fetch failed", e);
    return false;
  }
}

/**
 * Cron: POST + Authorization: Bearer <CRON_SECRET>
 *
 * Domyślnie **bez auto-kasacji** — `AUTO_PURGE_ENABLED=true` włącza purge po 30 dniach.
 *
 * Powiadomienia (Telegram, Markdown):
 * - TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 * - Ostrzeżenie 7 dni przed planowaną kasacją
 * - Lista stron gotowych do ręcznej kasacji (≥30 dni od trial_blocked_at)
 * Brak alertów danego dnia → 200 bez wysyłki wiadomości.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: "CRON_SECRET is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (token !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const autoPurge = envTruthy("AUTO_PURGE_ENABLED");
  const ts = new Date().toISOString();

  const { data: grantData, error: grantError } = await supabase.rpc("expire_manual_grants");
  if (grantError) {
    console.error("expire_manual_grants RPC error:", grantError);
  }
  const { count: expiredGrantCount, slugs: expiredGrantSlugs } = parseRpcPayload(grantData);
  if (expiredGrantCount > 0) {
    console.log(
      `expire_manual_grants: revoked ${expiredGrantCount}`,
      expiredGrantSlugs.length ? expiredGrantSlugs : "",
    );
  }

  const { data, error } = await supabase.rpc("expire_trial_pages");
  if (error) {
    console.error("expire_trial_pages RPC error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { count: blockedCount, slugs: blockedSlugs } = parseRpcPayload(data);
  console.log(`expire_trial_pages: blocked ${blockedCount} page(s)`, blockedSlugs.length ? blockedSlugs : "");

  const { data: warnData, error: warnError } = await supabase.rpc("notify_purge_upcoming_pages");
  if (warnError) {
    console.error("notify_purge_upcoming_pages RPC error:", warnError);
  }
  const { count: warnCount, pages: warnPages } = parsePurgeRpc(warnData);
  if (warnCount > 0) {
    console.log(`notify_purge_upcoming_pages: warned ${warnCount} page(s)`);
  }

  const { data: pendingData, error: pendingError } = await supabase.rpc("list_pages_pending_purge");
  if (pendingError) {
    console.error("list_pages_pending_purge RPC error:", pendingError);
  }
  const { count: pendingCount, pages: pendingPages } = parsePurgeRpc(pendingData);

  let purgeDeleted = 0;
  if (autoPurge) {
    const { data: purgeData, error: purgeError } = await supabase.rpc("purge_trial_blocked_pages_after_grace");
    if (purgeError) {
      console.error("purge_trial_blocked_pages_after_grace RPC error:", purgeError);
    } else if (purgeData && typeof purgeData === "object" && "deleted_count" in (purgeData as Record<string, unknown>)) {
      purgeDeleted = Number((purgeData as { deleted_count?: number }).deleted_count) || 0;
      if (purgeDeleted > 0) {
        console.log(`purge_trial_blocked_pages_after_grace: deleted ${purgeDeleted} page(s)`);
      }
    }
  }

  const pendingSlugs = pendingPages
    .map((p) => String(p.slug ?? "").trim())
    .filter(Boolean);
  const shouldNotifyTelegram = warnCount > 0 || (!autoPurge && pendingSlugs.length > 0);

  if (shouldNotifyTelegram) {
    for (const page of warnPages) {
      const slug = String(page.slug ?? "").trim();
      if (!slug) continue;
      await sendTelegramMessage(buildPurgeWarningMessage(slug));
    }

    if (!autoPurge && pendingSlugs.length > 0) {
      await sendTelegramMessage(buildManualPurgeReportMessage(pendingSlugs));
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      ts,
      auto_purge_enabled: autoPurge,
      expired_manual_grants: expiredGrantCount,
      expired_manual_grant_slugs: expiredGrantSlugs,
      newly_blocked_pages: blockedCount,
      blocked_slugs: blockedSlugs,
      purge_warning_7d_count: warnCount,
      purge_warning_pages: warnPages,
      pending_manual_purge_count: pendingCount,
      pending_purge_pages: pendingPages,
      purged_after_grace_days_30: purgeDeleted,
      telegram_notified: shouldNotifyTelegram,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
