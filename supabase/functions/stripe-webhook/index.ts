/**
 * Wymagane zdarzenia w Stripe Dashboard → Webhooks (ten endpoint):
 * checkout.session.completed,
 * customer.subscription.updated, customer.subscription.deleted,
 * invoice.paid, invoice.payment_succeeded, invoice.payment_failed
 *
 * Aktualizacje `pages` wyłącznie przez klienta z SUPABASE_SERVICE_ROLE_KEY (pomija RLS).
 *
 * wFirma (opcjonalnie): WFIRMA_ACCESS_KEY, WFIRMA_SECRET_KEY, WFIRMA_APP_KEY,
 * opcjonalnie WFIRMA_COMPANY_ID — błędy nie blokują dostępu w CMS.
 * Faktury: checkout.session.completed (pierwsza płatność) oraz invoice.paid /
 * invoice.payment_succeeded przy billing_reason subscription_update | subscription_cycle.
 */
import Stripe from "npm:stripe@^14.0.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";
import {
  applyInvoiceRenewalPaymentFailed,
  applyStripeSubscriptionToPage,
  applyOptsFromPriceEnv,
  applySubscriptionCanceledToPage,
  clearPageBillingBlocksForPaidUser,
  extractInvoiceSubscriptionId,
  resolveInvoiceSubscriptionId,
  findPageByUserId,
  firstRecurringPriceId,
  normalizeStripePaidTier,
  readStripePriceEnv,
  resolvePageForInvoice,
  resolvePageForStripeSubscription,
  subscriptionIsTerminated,
  tierFromStripePrice,
  type StripePaidTier,
  type StripePriceEnv,
} from "../_shared/stripeBilling.ts";
import {
  tryIssueWfirmaInvoiceForCheckout,
  tryIssueWfirmaInvoiceForStripeInvoice,
} from "../_shared/wfirmaBilling.ts";

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

/** Kolejka Stripe — log JSON do Supabase Functions Logs (filtrowanie po `stripe-webhook-queue`). */
function logWebhookQueue(
  event: Stripe.Event,
  phase: "start" | "done" | "skip",
  detail: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      tag: "stripe-webhook-queue",
      phase,
      event_id: event.id,
      event_type: event.type,
      created: event.created,
      created_iso: new Date(event.created * 1000).toISOString(),
      ...detail,
    }),
  );
}

/**
 * Udana opłata faktury (odnowienie lub pierwsza): odblokowanie + harmonogram wyłącznie z
 * `Stripe.Subscription.current_period_end` (brak `invoice.period_end` / lokalnych przybliżeń).
 */
function tierProductLabel(tier: StripePaidTier | undefined): string {
  if (tier === "tier0") return "DFCMS Starter";
  if (tier === "tier1") return "DFCMS Standard";
  return "Subskrypcja DFCMS";
}

/** wFirma — faktura po Checkout (pierwsza płatność). */
async function enqueueWfirmaInvoiceForCheckout(
  supabase: SupabaseClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  tier: StripePaidTier | undefined,
): Promise<void> {
  try {
    const enriched = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["customer_details.tax_ids"],
    });

    let productName = tierProductLabel(tier);

    try {
      const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
      const item = items.data[0];
      if (item?.description) {
        productName = item.description;
      } else if (item?.price?.product) {
        const prod = item.price.product;
        if (typeof prod === "object" && prod !== null && "name" in prod) {
          const n = (prod as Stripe.Product).name;
          if (n) productName = n;
        }
      }
    } catch (lineErr) {
      console.warn("wfirma: listLineItems", lineErr);
    }

    await tryIssueWfirmaInvoiceForCheckout({
      session: enriched,
      tierLabel: tier,
      productName,
    }, supabase);
  } catch (e) {
    console.error("wfirma: enqueue checkout invoice", e);
  }
}

/** wFirma — faktura po opłaceniu faktury Stripe (upgrade / odnowienie). */
async function enqueueWfirmaInvoiceForStripeInvoice(
  supabase: SupabaseClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  tier: StripePaidTier | undefined,
): Promise<void> {
  try {
    const reason = invoice.billing_reason;
    if (reason !== "subscription_update" && reason !== "subscription_cycle") {
      return;
    }
    await tryIssueWfirmaInvoiceForStripeInvoice(stripe, {
      invoice,
      tierLabel: tier,
      productName: tierProductLabel(tier),
    }, supabase);
  } catch (e) {
    console.error("wfirma: enqueue stripe invoice", invoice.id, e);
  }
}

async function handleInvoicePaymentSuccess(
  supabase: SupabaseClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  prices: StripePriceEnv,
): Promise<WebhookProcessResult> {
  let subscriptionId = extractInvoiceSubscriptionId(invoice);
  let subSource = subscriptionId ? "invoice_payload" : "";
  if (!subscriptionId) {
    subscriptionId = await resolveInvoiceSubscriptionId(stripe, invoice);
    subSource = subscriptionId ? "stripe_api_fallback" : "";
  }
  if (!subscriptionId) {
    console.warn(
      "handleInvoicePaymentSuccess: brak subscription id na fakturze (legacy + parent.subscription_details)",
      invoice.id,
    );
    return { skipped: "no_subscription_on_invoice" };
  }

  console.log(
    JSON.stringify({
      tag: "stripe-webhook-queue",
      phase: "start",
      handler: "handleInvoicePaymentSuccess",
      invoice_id: invoice.id,
      subscription_id: subscriptionId,
      sub_source: subSource,
    }),
  );

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

  const priceId = firstRecurringPriceId(subscription);
  const tierForWfirma = normalizeStripePaidTier(
    tierFromStripePrice(
      priceId,
      prices.priceStarter,
      prices.priceStarterYearly,
      prices.pricePro,
      prices.priceProYearly,
      "tier1",
    ),
  );
  void enqueueWfirmaInvoiceForStripeInvoice(supabase, stripe, invoice, tierForWfirma);

  return {};
}

async function processStripeWebhookEvent(
  event: Stripe.Event,
  supabase: SupabaseClient,
  stripe: Stripe,
  prices: StripePriceEnv,
): Promise<WebhookProcessResult> {
  const priceOpts = applyOptsFromPriceEnv(prices);
  logWebhookQueue(event, "start");
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

      logWebhookQueue(event, "start", {
        handler: "checkout.session.completed",
        user_id: userId,
        subscription_id: subId,
        stripe_status: subscription.status,
      });

      const result = await applyStripeSubscriptionToPage(supabase, page, subscription, {
        ...priceOpts,
        ...(tierFromMeta ? { tierOverride: tierFromMeta } : {}),
      });
      if (!result.ok) {
        return { dbError: logDbFailure("checkout.session.completed", result.error) };
      }

      const priceId = firstRecurringPriceId(subscription);
      const tierForWfirma =
        tierFromMeta ??
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
      void enqueueWfirmaInvoiceForCheckout(supabase, stripe, session, tierForWfirma);

      const st = subscription.status;
      if (st === "active" || st === "trialing") {
        const tier = tierForWfirma;
        const cleared = await clearPageBillingBlocksForPaidUser(supabase, userId, tier);
        if (!cleared.ok) {
          return { dbError: logDbFailure("checkout.session.completed.clear_pages", cleared.error) };
        }
        logWebhookQueue(event, "done", {
          handler: "checkout.session.completed",
          pages_cleared: true,
          billing_plan: tier,
        });
      } else {
        logWebhookQueue(event, "skip", {
          handler: "checkout.session.completed",
          reason: "subscription_not_active_yet",
          stripe_status: st,
          hint: "oczekuj invoice.paid / subscription.updated",
        });
      }
      return {};
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      logWebhookQueue(event, "start", {
        handler: "customer.subscription.updated",
        subscription_id: subscription.id,
        stripe_status: subscription.status,
      });
      const page = await resolvePageForStripeSubscription(supabase, subscription);
      if (!page?.id) {
        console.warn("stripe-webhook: updated — brak strony dla subscription", subscription.id);
        return { skipped: "no_page" };
      }
      const result = subscriptionIsTerminated(subscription)
        ? await applySubscriptionCanceledToPage(supabase, page, subscription, { stripe })
        : await applyStripeSubscriptionToPage(supabase, page, subscription, priceOpts);
      if (!result.ok) {
        return { dbError: logDbFailure("customer.subscription.updated", result.error) };
      }
      return {};
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      logWebhookQueue(event, "start", {
        handler: "customer.subscription.deleted",
        subscription_id: subscription.id,
      });
      const page = await resolvePageForStripeSubscription(supabase, subscription);
      if (!page?.id) {
        console.warn("stripe-webhook: deleted — brak strony dla subscription", subscription.id);
        return { skipped: "no_page" };
      }
      const result = await applySubscriptionCanceledToPage(supabase, page, subscription, { stripe });
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
      let subId = extractInvoiceSubscriptionId(invoice);
      if (!subId) {
        subId = await resolveInvoiceSubscriptionId(stripe, invoice);
      }
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
    logWebhookQueue(event, processResult.skipped ? "skip" : "done", {
      ...(processResult.skipped ? { skipped: processResult.skipped } : {}),
      ...(processResult.dbError ? { db_error: processResult.dbError } : {}),
    });
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
