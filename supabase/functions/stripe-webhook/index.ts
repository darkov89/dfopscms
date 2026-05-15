/**
 * Wymagane zdarzenia w Stripe Dashboard → Webhooks (ten endpoint):
 * checkout.session.completed,
 * customer.subscription.updated, customer.subscription.deleted,
 * invoice.paid, invoice.payment_succeeded, invoice.payment_failed
 *
 * Aktualizacje `pages` wyłącznie przez klienta z SUPABASE_SERVICE_ROLE_KEY (pomija RLS).
 */
// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyInvoiceRenewalPaymentFailed,
  applyStripeSubscriptionToPage,
  applySubscriptionCanceledToPage,
  extractInvoiceSubscriptionId,
  findPageByUserId,
  resolvePageForInvoice,
  resolvePageForStripeSubscription,
  type StripePaidTier,
} from "../_shared/stripeBilling.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

function tierPlanFromMetadata(planMeta: string | undefined | null): StripePaidTier | undefined {
  const p = String(planMeta || "").toLowerCase().trim();
  if (!p) return undefined;
  if (p === "premium" || p === "tier2") return "tier2";
  if (p === "pro" || p === "tier1") return "tier1";
  if (p === "starter" || p === "tier0") return "tier0";
  return undefined;
}

/**
 * Udana opłata faktury (odnowienie lub pierwsza): odblokowanie + harmonogram wyłącznie z
 * `Stripe.Subscription.current_period_end` (brak `invoice.period_end` / lokalnych przybliżeń).
 */
async function handleInvoicePaymentSuccess(
  supabase: ReturnType<typeof createClient>,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  priceStarter: string,
  pricePro: string,
  pricePremium: string,
): Promise<{ errorResponse?: Response }> {
  const subscriptionId = extractInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    console.warn(
      "handleInvoicePaymentSuccess: brak invoice.subscription — pomijam aktualizację okresu (wymagane API Subscription)",
      invoice.id,
    );
    return {};
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (e) {
    console.error("handleInvoicePaymentSuccess: subscriptions.retrieve", subscriptionId, e);
    return {
      errorResponse: new Response(JSON.stringify({ error: "Stripe subscription retrieve failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  let page = await resolvePageForStripeSubscription(supabase, subscription);
  if (!page?.id) {
    page = (await resolvePageForInvoice(supabase, stripe, invoice)) ?? null;
  }
  if (!page?.id) {
    console.warn("handleInvoicePaymentSuccess: brak pages dla faktury", invoice.id);
    return {};
  }

  const result = await applyStripeSubscriptionToPage(supabase, page, subscription, {
    priceStarter,
    pricePro,
    pricePremium,
  });
  if (!result.ok) {
    return {
      errorResponse: new Response(JSON.stringify({ error: result.error }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  return {};
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const priceStarter = Deno.env.get("STRIPE_PRICE_STARTER") ?? "";
  const pricePro = Deno.env.get("STRIPE_PRICE_PRO") ?? "";
  const pricePremium = Deno.env.get("STRIPE_PRICE_PREMIUM") ?? "";

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
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret, undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("stripe-webhook: podpis", msg);
    return new Response(JSON.stringify({ error: `Webhook signature: ${msg}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRole);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") {
          return jsonOk({ received: true, skipped: "not_subscription" });
        }

        const userId =
          (typeof session.client_reference_id === "string" && session.client_reference_id.trim()) ||
          (typeof session.metadata?.supabase_user_id === "string" && session.metadata.supabase_user_id.trim()) ||
          "";

        if (!userId) {
          console.warn("stripe-webhook: checkout.session.completed bez client_reference_id / supabase_user_id");
          return jsonOk({ received: true, skipped: "no_user" });
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
          return new Response(JSON.stringify({ error: "No subscription on session" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let subscription: Stripe.Subscription;
        try {
          subscription = await stripe.subscriptions.retrieve(subId);
        } catch (e) {
          console.error("stripe-webhook: retrieve subscription", e);
          return new Response(JSON.stringify({ error: "Stripe retrieve failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const page = await findPageByUserId(supabase, userId);
        if (!page?.id) {
          console.warn("stripe-webhook: brak wiersza pages dla user_id=", userId);
          return jsonOk({ received: true, skipped: "no_page" });
        }

        const result = await applyStripeSubscriptionToPage(supabase, page, subscription, {
          priceStarter,
          pricePro,
          pricePremium,
          ...(tierFromMeta ? { tierOverride: tierFromMeta } : {}),
        });
        if (!result.ok) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const page = await resolvePageForStripeSubscription(supabase, subscription);
        if (!page?.id) {
          console.warn("stripe-webhook: updated — brak strony dla subscription", subscription.id);
          return jsonOk({ received: true, skipped: "no_page" });
        }
        const result = await applyStripeSubscriptionToPage(supabase, page, subscription, {
          priceStarter,
          pricePro,
          pricePremium,
        });
        if (!result.ok) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const page = await resolvePageForStripeSubscription(supabase, subscription);
        if (!page?.id) {
          console.warn("stripe-webhook: deleted — brak strony dla subscription", subscription.id);
          return jsonOk({ received: true, skipped: "no_page" });
        }
        const result = await applySubscriptionCanceledToPage(supabase, page, subscription);
        if (!result.ok) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const { errorResponse } = await handleInvoicePaymentSuccess(
          supabase,
          stripe,
          invoice,
          priceStarter,
          pricePro,
          pricePremium,
        );
        if (errorResponse) return errorResponse;
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const reason = invoice.billing_reason;
        /** Pierwsza płatność przy utworzeniu subskrypcji — nie ustawiamy billing_failed jak przy odnowieniu. */
        if (reason !== "subscription_cycle" && reason !== "subscription_update") {
          return jsonOk({ received: true, skipped: "not_renewal_invoice", billing_reason: reason ?? null });
        }
        const subId = extractInvoiceSubscriptionId(invoice);
        if (subId) {
          await applyInvoiceRenewalPaymentFailed(supabase, subId);
        } else {
          const page = await resolvePageForInvoice(supabase, stripe, invoice);
          if (page?.id) {
            await supabase
              .from("pages")
              .update({ billing_failed_at: new Date().toISOString() })
              .eq("id", page.id);
          } else {
            console.warn("invoice.payment_failed: brak sub_id i strony", invoice.id);
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (e) {
    console.error("stripe-webhook handler", e);
    return new Response(JSON.stringify({ error: "Webhook handler error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return jsonOk({ received: true });
});

function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
