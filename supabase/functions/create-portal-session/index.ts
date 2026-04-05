// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findPageByUserId } from "../_shared/stripeBilling.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isAllowedOrigin(origin: string) {
  const o = origin.trim();
  if (o === "https://dfcms.pl") return true;
  if (o === "http://localhost:5500") return true;
  try {
    const u = new URL(o);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h.endsWith(".dfcms.pl")) return true;
    if (h.endsWith(".pages.dev")) return true;
    if (h === "localhost" || h === "127.0.0.1") return true;
    return false;
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

function subscriptionFromContent(
  content: unknown,
): Record<string, unknown> | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return undefined;
  }
  const pl = (content as Record<string, unknown>).pl;
  if (!pl || typeof pl !== "object") return undefined;
  const settings = (pl as Record<string, unknown>).settings;
  if (!settings || typeof settings !== "object") return undefined;
  const sub = (settings as Record<string, unknown>).subscription;
  if (!sub || typeof sub !== "object") return undefined;
  return sub as Record<string, unknown>;
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Brak autoryzacji");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !serviceRole || !stripeSecret) {
      throw new Error("Brak konfiguracji serwera (Supabase / Stripe).");
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser();
    if (userErr || !user?.id) {
      throw new Error("Wymagane zalogowanie.");
    }

    const body = await req.json().catch(() => ({}));
    const returnUrlRaw =
      typeof body?.returnUrl === "string" ? body.returnUrl.trim() : "";
    if (!returnUrlRaw || !/^https?:\/\//i.test(returnUrlRaw)) {
      throw new Error("Brak lub nieprawidłowy returnUrl");
    }
    const returnUrl = returnUrlRaw.replace(/\/$/, "");

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const page = await findPageByUserId(supabase, user.id);
    const subObj = page?.content ? subscriptionFromContent(page.content) : undefined;
    let customerId =
      typeof subObj?.stripe_customer_id === "string"
        ? subObj.stripe_customer_id.trim()
        : "";

    const stripe = new Stripe(stripeSecret, {
      apiVersion: "2022-11-15",
      httpClient: Stripe.createFetchHttpClient(),
    });

    if (!customerId && user.email) {
      const customers = await stripe.customers.list({ email: user.email, limit: 5 });
      customerId = customers.data[0]?.id ?? "";
    }

    if (!customerId) {
      throw new Error(
        "Brak profilu rozliczeniowego Stripe. Dokończ pierwszą płatność lub skontaktuj się z pomocą.",
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
