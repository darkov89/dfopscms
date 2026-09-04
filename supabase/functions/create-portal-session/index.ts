// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@^14.0.0";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import { findBillingProfileByUserId } from "../_shared/stripeBilling.ts";
import {
  assertAllowedReturnUrl,
  assertNotImpersonateReturnUrl,
  buildCorsHeadersForRequest,
} from "../_shared/allowedOrigins.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function buildCorsHeaders(req: Request) {
  return buildCorsHeadersForRequest(req, corsHeaders);
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
    const returnUrl = assertAllowedReturnUrl(
      typeof body?.returnUrl === "string" ? body.returnUrl : "",
    );
    assertNotImpersonateReturnUrl(returnUrl);

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const billing = await findBillingProfileByUserId(supabase, user.id);
    let customerId =
      typeof billing?.stripe_customer_id === "string"
        ? billing.stripe_customer_id.trim()
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

    const portalConfigurationId = Deno.env.get("STRIPE_BILLING_PORTAL_CONFIGURATION_ID") ?? "";

    let subscriptionId =
      typeof body?.subscription_id === "string" ? body.subscription_id.trim() : "";
    if (!subscriptionId && typeof billing?.stripe_subscription_id === "string") {
      subscriptionId = billing.stripe_subscription_id.trim();
    }

    const wantSubscriptionUpdateFlow =
      body?.flow === "subscription_update" || body?.subscriptionUpdate === true;
    const wantSubscriptionCancelFlow =
      body?.flow === "subscription_cancel" || body?.subscriptionCancel === true;
    const billingStatus = String(billing?.status ?? "").trim().toLowerCase();
    const liveForPlanChange = billingStatus === "active" || billingStatus === "trialing";
    const canUseSubscriptionFlows = !!subscriptionId && liveForPlanChange;

    const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
      customer: customerId,
      return_url: returnUrl,
      ...(portalConfigurationId ? { configuration: portalConfigurationId } : {}),
    };

    if (wantSubscriptionCancelFlow && canUseSubscriptionFlows) {
      sessionParams.flow_data = {
        type: "subscription_cancel",
        subscription_cancel: { subscription: subscriptionId },
      };
    } else if (wantSubscriptionUpdateFlow && canUseSubscriptionFlows) {
      sessionParams.flow_data = {
        type: "subscription_update",
        subscription_update: { subscription: subscriptionId },
      };
    }

    const session = await stripe.billingPortal.sessions.create(sessionParams);

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
