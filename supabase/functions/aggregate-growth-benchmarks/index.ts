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
 * Silnik Wzrostu (G2) — cron tygodniowy: przelicza `growth_benchmarks` przez RPC
 * `aggregate_growth_benchmarks()`. Wzorzec identyczny z `expire-trial-pages`
 * (Bearer CRON_SECRET, klient service_role).
 *
 * Harmonogram (Supabase Dashboard → Integrations → Cron): np. `0 3 * * 1` (poniedziałek 03:00 UTC).
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

  const { data, error } = await supabase.rpc("aggregate_growth_benchmarks");
  if (error) {
    console.error("aggregate_growth_benchmarks RPC error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const themesUpdated =
    data && typeof data === "object" && "themes_updated" in (data as Record<string, unknown>)
      ? Number((data as { themes_updated?: number }).themes_updated) || 0
      : 0;
  console.log(`aggregate_growth_benchmarks: updated ${themesUpdated} theme(s)`);

  return new Response(JSON.stringify({ ok: true, ...(data as Record<string, unknown>) }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
