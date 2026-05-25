// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@^14.0.0";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import {
  applyOptsFromPriceEnv,
  applyStripeSubscriptionToPage,
  clearPageBillingBlocksForPaidUser,
  findBillingProfileByUserId,
  findPageByUserId,
  firstRecurringPriceId,
  normalizeStripePaidTier,
  readStripePriceEnv,
  tierFromStripePrice,
  tierOverrideFromPriceId,
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

function pickBestSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  const rank = (s: Stripe.Subscription) => {
    if (s.status === "active") return 5;
    if (s.status === "trialing") return 4;
    if (s.status === "past_due") return 3;
    if (s.status === "unpaid") return 2;
    if (s.status === "canceled") return 1;
    return 0;
  };
  let best: Stripe.Subscription | null = null;
  let bestR = -1;
  for (const s of subs) {
    const r = rank(s);
    if (r > bestR) {
      bestR = r;
      best = s;
    }
  }
  return best;
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
    const prices = readStripePriceEnv();

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

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const page = await findPageByUserId(supabase, user.id);
    if (!page?.id) {
      throw new Error("Nie znaleziono strony dla tego konta.");
    }

    const stripe = new Stripe(stripeSecret, {
      apiVersion: "2022-11-15",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const billing = await findBillingProfileByUserId(supabase, user.id);

    let storedSubId =
      typeof billing?.stripe_subscription_id === "string" ? billing.stripe_subscription_id.trim() : "";
    const storedCustId =
      typeof billing?.stripe_customer_id === "string" ? billing.stripe_customer_id.trim() : "";

    let subscription: Stripe.Subscription | null = null;

    if (storedSubId) {
      try {
        subscription = await stripe.subscriptions.retrieve(storedSubId);
      } catch {
        storedSubId = "";
      }
    }

    if (!subscription && user.email) {
      const customers = await stripe.customers.list({ email: user.email, limit: 5 });
      const cid = storedCustId || customers.data[0]?.id;
      if (cid) {
        const subs = await stripe.subscriptions.list({
          customer: cid,
          status: "all",
          limit: 20,
        });
        subscription = pickBestSubscription(subs.data);
      }
    }

    if (!subscription) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Brak aktywnej subskrypcji Stripe dla tego konta. Jeśli dopiero zapłaciłeś, odczekaj chwilę lub sprawdź endpoint webhook w Stripe.",
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const priceId = firstRecurringPriceId(subscription);
    const tierOverride = tierOverrideFromPriceId(priceId, prices);

    const result = await applyStripeSubscriptionToPage(supabase, page, subscription, {
      ...applyOptsFromPriceEnv(prices),
      ...(tierOverride ? { tierOverride } : {}),
    });

    if (!result.ok) {
      throw new Error(result.error || "Błąd zapisu do bazy");
    }

    const st = subscription.status;
    let pagesCleared = false;
    if (st === "active" || st === "trialing") {
      const tier =
        tierOverride ??
        normalizeStripePaidTier(
          tierFromStripePrice(
            priceId,
            prices.priceStarter,
            prices.priceStarterYearly,
            prices.pricePro,
            prices.priceProYearly,
            "tier1",
          ),
        );
      const cleared = await clearPageBillingBlocksForPaidUser(supabase, user.id, tier);
      pagesCleared = cleared.ok;
      if (!cleared.ok) {
        throw new Error(cleared.error || "Nie udało się odblokować strony (pages)");
      }
    }

    console.log(
      JSON.stringify({
        tag: "sync-stripe-subscription",
        ok: true,
        user_id: user.id,
        stripe_status: st,
        subscription_id: subscription.id,
        pages_cleared: pagesCleared,
      }),
    );

    return new Response(
      JSON.stringify({
        ok: true,
        stripe_status: subscription.status,
        subscription_id: subscription.id,
        pages_cleared: pagesCleared,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
