// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import { buildCorsHeadersForRequest } from "../_shared/allowedOrigins.ts";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Cloudflare for SaaS: 1406 = Duplicate custom hostname found. */
function isDuplicateCustomHostname(cfData: {
  errors?: Array<{ code?: number; message?: string }>;
}): boolean {
  const errors = Array.isArray(cfData?.errors) ? cfData.errors : [];
  return errors.some((e) => {
    if (Number(e?.code) === 1406) return true;
    const msg = String(e?.message || "").toLowerCase();
    return msg.includes("duplicate custom hostname");
  });
}

serve(async (req) => {
  const cors = buildCorsHeadersForRequest(req, corsHeaders);
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
    if (!pageRow) {
      throw new Error("Brak uprawnień do tej strony");
    }

    const isOwner = pageRow.user_id === user.id;
    if (!isOwner) {
      const { data: superRow, error: superErr } = await supabaseAdmin
        .from("superadmins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (superErr) throw superErr;
      if (!superRow?.user_id) {
        throw new Error("Brak uprawnień do tej strony");
      }
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

    const cfData = await cfResponse.json().catch(() => ({}));
    const alreadyExists = isDuplicateCustomHostname(cfData);

    if ((!cfResponse.ok || !cfData.success) && !alreadyExists) {
      console.error("Błąd Cloudflare:", cfData);
      throw new Error(
        cfData.errors?.[0]?.message || "Błąd integracji z Cloudflare",
      );
    }

    const { error: dbError } = await supabaseAdmin
      .from("pages")
      .update({
        custom_domain: hostname,
        custom_domain_status: "pending",
      })
      .eq("id", pageId);

    if (dbError) throw dbError;

    return new Response(
      JSON.stringify({
        success: true,
        message: alreadyExists
          ? "Domena już była w Cloudflare — odświeżono zapis"
          : "Domena dodana do Cloudflare",
        hostname,
        alreadyExists,
        data: alreadyExists ? null : cfData.result,
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
