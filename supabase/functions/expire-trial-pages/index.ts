// @ts-ignore - remote Deno std module
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

type RpcResult = { count?: number; slugs?: string[] };

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

/**
 * Cron: POST + Authorization: Bearer <CRON_SECRET>
 *
 * Powiadomienia operacyjne (opcjonalnie, jedna z dróg):
 * - OPS_NOTIFY_WEBHOOK_URL — POST JSON { count, slugs, ts } (np. Zapier → e-mail na dariusz.rink@gmail.com)
 * - RESEND_API_KEY + OPS_NOTIFY_EMAIL + RESEND_FROM — e-mail przez Resend (typowo RESEND_FROM=DFCMS <notifications@dfops.eu>)
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

  const { data, error } = await supabase.rpc("expire_trial_pages");

  if (error) {
    console.error("expire_trial_pages RPC error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { count, slugs } = parseRpcPayload(data);
  const ts = new Date().toISOString();
  console.log(`expire_trial_pages: blocked ${count} page(s)`, slugs.length ? slugs : "");

  let purgeDeleted = 0;
  const { data: purgeData, error: purgeError } = await supabase.rpc("purge_trial_blocked_pages_after_grace");
  if (purgeError) {
    console.error("purge_trial_blocked_pages_after_grace RPC error:", purgeError);
  } else if (purgeData && typeof purgeData === "object" && "deleted_count" in (purgeData as Record<string, unknown>)) {
    purgeDeleted = Number((purgeData as { deleted_count?: number }).deleted_count) || 0;
    if (purgeDeleted > 0) {
      console.log(`purge_trial_blocked_pages_after_grace: deleted ${purgeDeleted} page(s)`);
    }
  }

  const payload = { count, slugs, ts, reason: "trial_expired_or_billing_grace_elapsed" };

  const hook = Deno.env.get("OPS_NOTIFY_WEBHOOK_URL")?.trim();
  if (hook && count > 0) {
    try {
      const r = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) console.warn("OPS_NOTIFY_WEBHOOK_URL", r.status, await r.text());
    } catch (e) {
      console.warn("OPS_NOTIFY_WEBHOOK_URL fetch failed", e);
    }
  }

  const notifyTo = Deno.env.get("OPS_NOTIFY_EMAIL")?.trim();
  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const fromAddr = Deno.env.get("RESEND_FROM")?.trim() ?? "DFCMS <notifications@dfops.eu>";
  if (notifyTo && resendKey && count > 0) {
    try {
      const slugList = slugs.length ? slugs.join(", ") : "—";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [notifyTo],
          subject: `DFCMS: zablokowano widok publiczny (${count})`,
          html:
            `<p>Widok publiczny został ukryty dla <strong>${count}</strong> stron (wygasły trial / minął 14-dniowy termin po problemie z płatnością).</p>` +
            `<p><strong>Slugi:</strong> ${slugList}</p>` +
            `<p>Czas: ${ts}</p>`,
        }),
      });
      if (!r.ok) console.warn("Resend", r.status, await r.text());
    } catch (e) {
      console.warn("Resend notify failed", e);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      newly_blocked_pages: count,
      slugs,
      purged_after_grace_days_30: purgeDeleted,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
