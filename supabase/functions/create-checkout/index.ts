// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@^14.0.0";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import { findBillingProfileByUserId } from "../_shared/stripeBilling.ts";

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
 * - w `billing_profiles` + `pages.billing_plan` (service_role).
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
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

    let existingCustomerId = "";
    if (serviceRole) {
      const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const billing = await findBillingProfileByUserId(supabaseAdmin, user.id);
      const existingSubId =
        typeof billing?.stripe_subscription_id === "string"
          ? billing.stripe_subscription_id.trim()
          : "";
      const billingStatus =
        typeof billing?.status === "string" ? billing.status.trim().toLowerCase() : "";
      const subscriptionBlocksCheckout =
        !!existingSubId &&
        (billingStatus === "active" ||
          billingStatus === "trialing" ||
          billingStatus === "past_due");
      if (subscriptionBlocksCheckout) {
        return new Response(
          JSON.stringify({
            error:
              "Masz już subskrypcję Stripe. Upgrade wykonasz w panelu (zmiana planu); downgrade i faktury — w portalu klienta zgodnie z regulaminem.",
            code: "HAS_STRIPE_SUBSCRIPTION",
          }),
          {
            status: 409,
            headers: { ...cors, "Content-Type": "application/json" },
          },
        );
      }
      existingCustomerId =
        typeof billing?.stripe_customer_id === "string"
          ? billing.stripe_customer_id.trim()
          : "";
    }

    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    if (!stripeSecret) {
      throw new Error("Brak STRIPE_SECRET_KEY na serwerze");
    }

    const priceStarter = Deno.env.get("STRIPE_PRICE_STARTER") ?? "";
    const priceStarterYearly = Deno.env.get("STRIPE_PRICE_STARTER_YEARLY") ?? "";
    const pricePro = Deno.env.get("STRIPE_PRICE_PRO") ?? "";
    const priceProYearly = Deno.env.get("STRIPE_PRICE_PRO_YEARLY") ?? "";
    const allowed = new Set(
      [priceStarter, priceStarterYearly, pricePro, priceProYearly].filter(Boolean),
    );

    const body = await req.json().catch(() => ({}));
    const rawPrice =
      typeof body?.priceId === "string" ? body.priceId.trim() : "";
    const plan = typeof body?.plan === "string" ? body.plan.trim().toLowerCase() : "";
    const intervalRaw = typeof body?.interval === "string" ? body.interval.trim().toLowerCase() : "monthly";
    const interval = intervalRaw === "yearly" || intervalRaw === "annual" || intervalRaw === "year"
      ? "yearly"
      : "monthly";

    const isProPlan = plan === "pro" || plan === "standard" || plan === "tier1";
    const isStarterPlan = plan === "starter" || plan === "tier0";

    let priceId = "";
    if (isStarterPlan) {
      priceId = interval === "yearly" ? priceStarterYearly : priceStarter;
    } else if (isProPlan) {
      priceId = interval === "yearly" ? priceProYearly : pricePro;
    } else if (plan === "premium" || plan === "tier2") {
      throw new Error("Pakiet Premium nie jest już dostępny. Wybierz Starter lub Standard.");
    } else if (rawPrice && allowed.has(rawPrice)) {
      priceId = rawPrice;
    } else if (
      (isProPlan || isStarterPlan) &&
      rawPrice &&
      (rawPrice.startsWith("price_") || rawPrice.startsWith("prod_"))
    ) {
      /** Gdy Secrets nieustawione — body z config.js (staging). */
      priceId = rawPrice;
    }

    if (!priceId) {
      throw new Error(
        "Nieprawidłowy plan, okres lub cena. Ustaw Secrets STRIPE_PRICE_* (w tym *_YEARLY) albo stripePrices w config.js.",
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

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${returnUrl}?payment=success`,
      cancel_url: `${returnUrl}?payment=cancelled`,
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        billing_interval: interval,
        plan:
          isStarterPlan
            ? "starter"
            : isProPlan
              ? "standard"
              : plan ||
                  (resolvedPriceId === priceStarter || resolvedPriceId === priceStarterYearly
                    ? "starter"
                    : resolvedPriceId === pricePro || resolvedPriceId === priceProYearly
                      ? "standard"
                      : ""),
      },
    };
    /** Stripe: `customer` i `customer_email` są wzajemnie wykluczające. */
    if (existingCustomerId) {
      sessionParams.customer = existingCustomerId;
    } else if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

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
