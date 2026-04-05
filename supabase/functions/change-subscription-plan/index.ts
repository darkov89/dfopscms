/**
 * Zmiana planu Pro ↔ Premium na istniejącej subskrypcji Stripe — zgodnie z regulaminem:
 * - upgrade: natychmiast, prorata (always_invoice),
 * - downgrade na niższy plan: wyłącznie przez Customer Portal (typowe ustawienie Stripe: zmiana od następnego okresu + kredyt).
 */
// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  findPageByUserId,
  firstRecurringPriceId,
  priceTierRank,
  subscriptionObjFromContent,
} from "../_shared/stripeBilling.ts";

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

async function resolveToPriceId(stripe: Stripe, id: string): Promise<string> {
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
    const priceStarter = Deno.env.get("STRIPE_PRICE_STARTER") ?? "";
    const priceTestDaily = Deno.env.get("STRIPE_PRICE_TEST_DAILY") ?? "";
    const pricePro = Deno.env.get("STRIPE_PRICE_PRO") ?? "";
    const pricePremium = Deno.env.get("STRIPE_PRICE_PREMIUM") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !serviceRole || !stripeSecret) {
      throw new Error("Brak konfiguracji serwera.");
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
    const plan = typeof body?.plan === "string" ? body.plan.trim().toLowerCase() : "";
    if (plan !== "pro" && plan !== "premium" && plan !== "test_daily") {
      throw new Error('Podaj plan: "pro", "premium" lub "test_daily".');
    }

    let targetPriceId =
      plan === "premium" ? pricePremium : plan === "test_daily" ? priceTestDaily : pricePro;
    const rawPrice =
      typeof body?.priceId === "string" ? body.priceId.trim() : "";
    const allowed = new Set([pricePro, pricePremium, priceTestDaily].filter(Boolean));
    if (rawPrice && allowed.has(rawPrice)) targetPriceId = rawPrice;
    else if (
      rawPrice &&
      (rawPrice.startsWith("price_") || rawPrice.startsWith("prod_")) &&
      (plan === "pro" || plan === "premium" || plan === "test_daily")
    ) {
      targetPriceId = rawPrice;
    }

    if (!targetPriceId) {
      throw new Error(
        "Brak STRIPE_PRICE_PRO / PREMIUM / TEST_DAILY (Secrets) lub priceId w żądaniu.",
      );
    }

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const page = await findPageByUserId(supabase, user.id);
    if (!page?.id) {
      throw new Error("Nie znaleziono strony dla tego konta.");
    }

    const subObj = page.content ? subscriptionObjFromContent(page.content) : undefined;
    const subId =
      typeof subObj?.stripe_subscription_id === "string"
        ? subObj.stripe_subscription_id.trim()
        : "";

    if (!subId) {
      throw new Error("Brak aktywnej subskrypcji Stripe — najpierw dokończ pierwszą płatność (Checkout).");
    }

    const stripe = new Stripe(stripeSecret, {
      apiVersion: "2022-11-15",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const resolvedNewPriceId = await resolveToPriceId(stripe, targetPriceId);

    const subscription = await stripe.subscriptions.retrieve(subId, {
      expand: ["items.data.price"],
    });

    if (subscription.status !== "active" && subscription.status !== "trialing") {
      throw new Error(
        `Subskrypcja ma status „${subscription.status}”. Skontaktuj się z pomocą lub użyj portalu płatności.`,
      );
    }

    const item = subscription.items?.data?.[0];
    const itemId = item?.id;
    if (!itemId) {
      throw new Error("Brak pozycji subskrypcji w Stripe.");
    }

    const currentPriceId = firstRecurringPriceId(subscription);
    if (currentPriceId === resolvedNewPriceId) {
      return new Response(JSON.stringify({ ok: true, unchanged: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const curRank = priceTierRank(currentPriceId, priceStarter, pricePro, pricePremium, priceTestDaily);
    const newRank = priceTierRank(resolvedNewPriceId, priceStarter, pricePro, pricePremium, priceTestDaily);

    /** Oba rozpoznane jako Pro/Premium i downgrade po cenniku → portal (następny okres + kredyt wg Stripe). */
    if (curRank >= 1 && newRank >= 1 && newRank < curRank) {
      return new Response(
        JSON.stringify({
          action: "use_portal",
          message:
            "Zmiana na niższy pakiet jest realizowana w portalu Stripe — zwykle od następnego okresu rozliczeniowego, z uwzględnieniem kredytu na koncie. Za chwilę otworzymy portal.",
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    /** Upgrade lub przejście z nierozpoznanej ceny na Pro/Premium — natychmiastowa prorata. */
    await stripe.subscriptions.update(subId, {
      items: [{ id: itemId, price: resolvedNewPriceId }],
      proration_behavior: "always_invoice",
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
