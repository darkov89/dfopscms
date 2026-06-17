// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function isAllowedOrigin(origin: string) {
  const o = origin.trim();
  if (o === "https://dfcms.pl") return true;
  if (o === "http://localhost:5500") return true;
  try {
    const u = new URL(o);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    return h.endsWith(".dfcms.pl");
  } catch {
    return false;
  }
}

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  if (!origin || !isAllowedOrigin(origin)) return null;
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  } as Record<string, string>;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (!cors) {
    return new Response(JSON.stringify({ success: false, error: "CORS: origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Brak autoryzacji");
    }

    const body = await req.json();
    const rawDomain = typeof body?.domain === "string" ? body.domain.trim() : "";
    const hostname = rawDomain
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./i, "")
      .toLowerCase();
    const pageId = body?.pageId;

    if (!hostname || !pageId) {
      throw new Error("Brak wymaganych parametrów: domain lub pageId");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser();
    if (userErr || !user) {
      throw new Error("Nieautoryzowany");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: pageRow, error: pageErr } = await supabaseAdmin
      .from("pages")
      .select("id, user_id")
      .eq("id", pageId)
      .limit(1)
      .maybeSingle();

    if (pageErr) throw pageErr;
    if (!pageRow || pageRow.user_id !== user.id) {
      throw new Error("Brak uprawnień do tej strony");
    }

    const CF_ZONE_ID = Deno.env.get("CF_ZONE_ID");
    const CF_API_TOKEN = Deno.env.get("CF_API_TOKEN");

    if (!CF_ZONE_ID || !CF_API_TOKEN) {
      throw new Error("Brak konfiguracji Cloudflare na serwerze");
    }

    const cfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/custom_hostnames`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname,
          ssl: {
            method: "http",
            type: "dv",
          },
        }),
      },
    );

    const cfData = await cfResponse.json();

    if (!cfResponse.ok || !cfData.success) {
      console.error("Błąd Cloudflare:", cfData);
      throw new Error(
        cfData.errors?.[0]?.message || "Błąd integracji z Cloudflare",
      );
    }

    const { error: dbError } = await supabaseAdmin
      .from("pages")
      .update({
        custom_domain: hostname,
        custom_domain_status: "pending_validation",
      })
      .eq("id", pageId);

    if (dbError) throw dbError;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Domena dodana do Cloudflare",
        data: cfData.result,
      }),
      {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
