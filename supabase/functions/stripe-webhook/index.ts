/**
 * Wymagane zdarzenia w Stripe Dashboard → Webhooks (ten endpoint):
 * checkout.session.completed,
 * customer.subscription.updated, customer.subscription.deleted,
 * invoice.paid, invoice.payment_succeeded, invoice.payment_failed
 *
 * Aktualizacje `pages` wyłącznie przez klienta z SUPABASE_SERVICE_ROLE_KEY (pomija RLS).
 */
import Stripe from "npm:stripe@^14.0.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";
import {
  applyInvoiceRenewalPaymentFailed,
  applyStripeSubscriptionToPage,
  applyOptsFromPriceEnv,
  applySubscriptionCanceledToPage,
  extractInvoiceSubscriptionId,
  findPageByUserId,
  readStripePriceEnv,
  resolvePageForInvoice,
  resolvePageForStripeSubscription,
  subscriptionIsTerminated,
  type StripePaidTier,
  type StripePriceEnv,
} from "../_shared/stripeBilling.ts";

type WebhookProcessResult = {
  skipped?: string;
  dbError?: string;
};

function tierPlanFromMetadata(planMeta: string | undefined | null): StripePaidTier | undefined {
  const p = String(planMeta || "").toLowerCase().trim();
  if (!p) return undefined;
  if (p === "premium" || p === "tier2" || p === "pro" || p === "standard" || p === "tier1") {
    return "tier1";
  }
  if (p === "starter" || p === "tier0") return "tier0";
  return undefined;
}

function logDbFailure(context: string, message: string | undefined): string {
  const errText = message || "unknown_db_error";
  console.error(`Supabase DB Error (${context}):`, errText);
  return errText;
}

/**
 * Udana opłata faktury (odnowienie lub pierwsza): odblokowanie + harmonogram wyłącznie z
 * `Stripe.Subscription.current_period_end` (brak `invoice.period_end` / lokalnych przybliżeń).
 */
async function handleInvoicePaymentSuccess(
  supabase: SupabaseClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  prices: StripePriceEnv,
): Promise<WebhookProcessResult> {
  const subscriptionId = extractInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    console.warn(
      "handleInvoicePaymentSuccess: brak invoice.subscription — pomijam aktualizację okresu (wymagane API Subscription)",
      invoice.id,
    );
    return { skipped: "no_subscription_on_invoice" };
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (e) {
    console.error("handleInvoicePaymentSuccess: subscriptions.retrieve", subscriptionId, e);
    throw e;
  }

  let page = await resolvePageForStripeSubscription(supabase, subscription);
  if (!page?.id) {
    page = (await resolvePageForInvoice(supabase, stripe, invoice)) ?? null;
  }
  if (!page?.id) {
    console.warn("handleInvoicePaymentSuccess: brak pages dla faktury", invoice.id);
    return { skipped: "no_page" };
  }

  const result = await applyStripeSubscriptionToPage(
    supabase,
    page,
    subscription,
    applyOptsFromPriceEnv(prices),
  );
  if (!result.ok) {
    return { dbError: logDbFailure("handleInvoicePaymentSuccess", result.error) };
  }
  return {};
}

async function processStripeWebhookEvent(
  event: Stripe.Event,
  supabase: SupabaseClient,
  stripe: Stripe,
  prices: StripePriceEnv,
): Promise<WebhookProcessResult> {
  const priceOpts = applyOptsFromPriceEnv(prices);
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") {
        return { skipped: "not_subscription" };
      }

      const userId =
        (typeof session.client_reference_id === "string" && session.client_reference_id.trim()) ||
        (typeof session.metadata?.supabase_user_id === "string" && session.metadata.supabase_user_id.trim()) ||
        "";

      if (!userId) {
        console.warn("stripe-webhook: checkout.session.completed bez client_reference_id / supabase_user_id");
        return { skipped: "no_user" };
      }

      const tierFromMeta = tierPlanFromMetadata(session.metadata?.plan);

      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription &&
              typeof session.subscription === "object" &&
              "id" in session.subscription
            ? (session.subscription as { id: string }).id
            : null;

      if (!subId) {
        console.warn("stripe-webhook: brak session.subscription");
        return { skipped: "no_subscription_on_session" };
      }

      let subscription: Stripe.Subscription;
      try {
        subscription = await stripe.subscriptions.retrieve(subId);
      } catch (e) {
        console.error("stripe-webhook: retrieve subscription", e);
        throw e;
      }

      const page = await findPageByUserId(supabase, userId);
      if (!page?.id) {
        console.warn("stripe-webhook: brak wiersza pages dla user_id=", userId);
        return { skipped: "no_page" };
      }

      const result = await applyStripeSubscriptionToPage(supabase, page, subscription, {
        ...priceOpts,
        ...(tierFromMeta ? { tierOverride: tierFromMeta } : {}),
      });
      if (!result.ok) {
        return { dbError: logDbFailure("checkout.session.completed", result.error) };
      }
      return {};
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const page = await resolvePageForStripeSubscription(supabase, subscription);
      if (!page?.id) {
        console.warn("stripe-webhook: updated — brak strony dla subscription", subscription.id);
        return { skipped: "no_page" };
      }
      const result = subscriptionIsTerminated(subscription)
        ? await applySubscriptionCanceledToPage(supabase, page, subscription)
        : await applyStripeSubscriptionToPage(supabase, page, subscription, priceOpts);
      if (!result.ok) {
        return { dbError: logDbFailure("customer.subscription.updated", result.error) };
      }
      return {};
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const page = await resolvePageForStripeSubscription(supabase, subscription);
      if (!page?.id) {
        console.warn("stripe-webhook: deleted — brak strony dla subscription", subscription.id);
        return { skipped: "no_page" };
      }
      const result = await applySubscriptionCanceledToPage(supabase, page, subscription);
      if (!result.ok) {
        return { dbError: logDbFailure("customer.subscription.deleted", result.error) };
      }
      return {};
    }

    case "invoice.payment_succeeded":
    case "invoice.paid": {
      return await handleInvoicePaymentSuccess(
        supabase,
        stripe,
        event.data.object as Stripe.Invoice,
        prices,
      );
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const reason = invoice.billing_reason;
      if (reason !== "subscription_cycle" && reason !== "subscription_update") {
        return { skipped: "not_renewal_invoice" };
      }
      const subId = extractInvoiceSubscriptionId(invoice);
      if (subId) {
        const result = await applyInvoiceRenewalPaymentFailed(supabase, subId);
        if (!result.ok) {
          return { dbError: logDbFailure("invoice.payment_failed", result.error) };
        }
        return {};
      }
      const page = await resolvePageForInvoice(supabase, stripe, invoice);
      if (!page?.id) {
        console.warn("invoice.payment_failed: brak sub_id i strony", invoice.id);
        return { skipped: "no_page" };
      }
      const { error } = await supabase
        .from("pages")
        .update({ billing_failed_at: new Date().toISOString() })
        .eq("id", page.id);
      if (error) {
        return { dbError: logDbFailure("invoice.payment_failed.page", error.message) };
      }
      return {};
    }

    default:
      return { skipped: "unhandled_event_type" };
  }
}

function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const prices = readStripePriceEnv();

  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceRole) {
    console.error(
      "stripe-webhook: brak STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2022-11-15",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("stripe-webhook: podpis", msg);
    return new Response(JSON.stringify({ error: `Webhook signature: ${msg}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let processResult: WebhookProcessResult = {};
  try {
    processResult = await processStripeWebhookEvent(event, supabase, stripe, prices);
  } catch (e) {
    console.error("stripe-webhook handler", e);
    return new Response(JSON.stringify({ error: "Webhook handler error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return jsonOk({
    received: true,
    event_type: event.type,
    ...(processResult.skipped ? { skipped: processResult.skipped } : {}),
    ...(processResult.dbError ? { db_error: processResult.dbError } : {}),
  });
});
