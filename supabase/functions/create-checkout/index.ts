// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Deno global - available at runtime in Supabase Edge Functions. */
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
    /** Cloudflare Pages (staging / preview), np. *.pages.dev */
    if (h.endsWith(".pages.dev")) return true;
    if (h === "localhost" || h === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}

/** Checkout wymaga price_; prod_ → domyślna cena produktu. */
async function resolveToPriceId(
  stripe: Stripe,
  id: string,
): Promise<string> {
  const t = id.trim();
  if (!t) throw new Error("Pusty identyfikator Stripe");
  if (t.startsWith("price_")) return t;
  if (t.startsWith("prod_")) {
    const product = await stripe.products.retrieve(t, {
      expand: ["default_price"],
    });
    const dp = product.default_price;
    if (typeof dp === "string") return dp;
    if (dp && typeof dp === "object" && "id" in dp) {
      return (dp as Stripe.Price).id;
    }
    throw new Error(
      "Produkt Stripe nie ma default price — dodaj cenę (recurring) w Dashboard.",
    );
  }
  throw new Error("Nieobsługiwany format ID (oczekiwano price_… lub prod_…).");
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

/**
 * Po zakończeniu płatności webhook Stripe powinien w bazie:
 * - `trial_blocked_at` = NULL, `billing_failed_at` = NULL (pełne odblokowanie publicznego widoku),
 * - w `content.pl.settings.subscription`: plan + `payment_completed: true`, wyczyścić `selected_plan` gdzie trzeba.
 *
 * invoice.payment_failed / subscription past_due:
 * - ustaw `billing_failed_at` = COALESCE(billing_failed_at, now()) (pierwsza nieudana próba),
 * - po 14 dniach cron ustawi `trial_blocked_at` (ta sama blokada co przy wygasłym trialu).
 */
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
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser();
    if (userErr || !user?.email) {
      throw new Error("Wymagane zalogowanie.");
    }

    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeSecret) {
      throw new Error("Brak STRIPE_SECRET_KEY na serwerze");
    }

    const pricePro = Deno.env.get("STRIPE_PRICE_PRO") ?? "";
    const pricePremium = Deno.env.get("STRIPE_PRICE_PREMIUM") ?? "";
    const allowed = new Set([pricePro, pricePremium].filter(Boolean));

    const body = await req.json().catch(() => ({}));
    const rawPrice =
      typeof body?.priceId === "string" ? body.priceId.trim() : "";
    const plan = typeof body?.plan === "string" ? body.plan.trim() : "";

    let priceId = "";
    if (plan === "pro" && pricePro) priceId = pricePro;
    else if (plan === "premium" && pricePremium) priceId = pricePremium;
    else if (rawPrice && allowed.has(rawPrice)) priceId = rawPrice;
    else if (
      (plan === "pro" || plan === "premium") &&
      rawPrice &&
      (rawPrice.startsWith("price_") || rawPrice.startsWith("prod_"))
    ) {
      /** Gdy Secrets nieustawione — body z config.js (staging). */
      priceId = rawPrice;
    }

    if (!priceId) {
      throw new Error(
        "Nieprawidłowy plan lub cena. Ustaw STRIPE_PRICE_PRO i STRIPE_PRICE_PREMIUM (Secrets) albo stripePrices w js/core/config.js (price_ lub prod_).",
      );
    }

    const returnUrlRaw =
      typeof body?.returnUrl === "string" ? body.returnUrl.trim() : "";
    if (!returnUrlRaw || !/^https?:\/\//i.test(returnUrlRaw)) {
      throw new Error("Brak lub nieprawidłowy returnUrl");
    }
    const returnUrl = returnUrlRaw.replace(/\/$/, "");

    const emailFromBody =
      typeof body?.userEmail === "string" ? body.userEmail.trim() : "";
    const customerEmail =
      user.email || (emailFromBody.includes("@") ? emailFromBody : "");

    const stripe = new Stripe(stripeSecret, {
      apiVersion: "2022-11-15",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const resolvedPriceId = await resolveToPriceId(stripe, priceId);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "blik"],
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      mode: "subscription",
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      success_url: `${returnUrl}?payment=success`,
      cancel_url: `${returnUrl}?payment=cancelled`,
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        plan:
          plan ||
          (resolvedPriceId === pricePro
            ? "pro"
            : resolvedPriceId === pricePremium
              ? "premium"
              : ""),
      },
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
