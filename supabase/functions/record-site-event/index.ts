// @ts-ignore - remote Deno std module
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Silnik Wzrostu (G1) — zapis konwersji publicznych do `analytics_events`.
 * Kontrakt: docs/GROWTH_AUTOPILOT_ARCHITECTURE.md §4.1.
 *
 * POST { slug, event_type, source? }
 * 200 { ok: true } | { ok: true, skipped: 'preview' | 'rate_limited' }
 * 400 invalid payload | 404 unknown slug
 */

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

const EVENT_TYPES = new Set([
  "phone_click",
  "booking_click",
  "whatsapp_click",
  "messenger_click",
  "email_click",
  "map_click",
]);

const SOURCES = new Set(["hero", "nav", "footer", "booking_section", "fab", "contact", "gallery", "menu"]);

/** In-memory rate limit — per instancję Edge (v0, wystarczające przeciw prostemu spamowi). */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_HITS = 20;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_HITS) return true;
  return false;
}

/** Sprzątanie starych kubełków, żeby mapa nie rosła bez końca w długo żyjącej instancji. */
function sweepRateLimitBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  }
}

async function hashVisitorKey(ip: string, slug: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${ip}|${slug}|${day}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

/** Podgląd panelu (`?dfcms_preview=1`) nie powinien liczyć się jako realna konwersja. */
function looksLikePreview(body: Record<string, unknown>, req: Request): boolean {
  if (body?.preview === true) return true;
  const referer = req.headers.get("referer") || "";
  try {
    if (referer && new URL(referer).searchParams.get("dfcms_preview") === "1") return true;
  } catch (_e) {
    // referer niepoprawny URL — ignoruj, nie blokuj zdarzenia z tego powodu
  }
  return false;
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const slug = String(body?.slug ?? "").trim().toLowerCase();
  const eventType = String(body?.event_type ?? "").trim();
  const source = String(body?.source ?? "").trim().toLowerCase();

  if (!SLUG_RE.test(slug) || !EVENT_TYPES.has(eventType)) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const safeSource = SOURCES.has(source) ? source : "other";

  if (looksLikePreview(body, req)) {
    return new Response(JSON.stringify({ ok: true, skipped: "preview" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ip = clientIp(req);
  sweepRateLimitBuckets();
  if (isRateLimited(`${ip}:${slug}`)) {
    return new Response(JSON.stringify({ ok: true, skipped: "rate_limited" }), {
      status: 429,
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

  const { data: page, error: pageError } = await supabase
    .from("pages")
    .select("id")
    .eq("slug", slug)
    .not("content", "is", null)
    .is("trial_blocked_at", null)
    .limit(1)
    .maybeSingle();

  if (pageError) {
    console.error("record-site-event: page lookup error", pageError);
    return new Response(JSON.stringify({ error: "Lookup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!page?.id) {
    return new Response(JSON.stringify({ error: "Unknown slug" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const visitorKey = await hashVisitorKey(ip, slug);

  const { error: insertError } = await supabase.from("analytics_events").insert({
    user_id: null,
    page_id: page.id,
    slug,
    event_name: eventType,
    event_scope: "conversion",
    source: safeSource,
    visitor_key: visitorKey,
  });

  if (insertError) {
    console.error("record-site-event: insert error", insertError);
    return new Response(JSON.stringify({ error: "Insert failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
