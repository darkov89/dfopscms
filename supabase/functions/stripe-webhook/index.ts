/**
 * Wymagane zdarzenia w Stripe Dashboard → Webhooks (ten endpoint):
 * checkout.session.completed, customer.subscription.updated, customer.subscription.deleted,
 * invoice.paid, invoice.payment_failed
 */
// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyInvoicePaymentFailed,
  applyStripeSubscriptionToPage,
  findPageByUserId,
  resolvePageForStripeSubscription,
} from "../_shared/stripeBilling.ts";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

/** Z metadata Checkout (pro | premium) → plan w content (tier1 | tier2). */
function tierPlanFromMetadata(planMeta: string | undefined | null): "tier1" | "tier2" {
  const p = String(planMeta || "").toLowerCase().trim();
  if (p === "premium" || p === "tier2") return "tier2";
  if (p === "pro" || p === "tier1") return "tier1";
  return "tier1";
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
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

        const metadataPlan = session.metadata?.plan;
        const tierOverride = tierPlanFromMetadata(metadataPlan);

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
          pricePro,
          pricePremium,
          tierOverride,
        });
        if (!result.ok) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const page = await resolvePageForStripeSubscription(supabase, subscription);
        if (!page?.id) {
          console.warn("stripe-webhook: brak strony dla subscription", subscription.id);
          return jsonOk({ received: true, skipped: "no_page" });
        }
        const result = await applyStripeSubscriptionToPage(supabase, page, subscription, {
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
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subRaw = invoice.subscription;
        const subId = typeof subRaw === "string" ? subRaw : subRaw && typeof subRaw === "object" && "id" in subRaw
          ? (subRaw as { id: string }).id
          : "";
        if (!subId) return jsonOk({ received: true, skipped: "no_subscription_on_invoice" });
        let subscription: Stripe.Subscription;
        try {
          subscription = await stripe.subscriptions.retrieve(subId);
        } catch (e) {
          console.error("stripe-webhook: invoice.paid retrieve", e);
          return new Response(JSON.stringify({ error: "Stripe retrieve failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const page = await resolvePageForStripeSubscription(supabase, subscription);
        if (!page?.id) return jsonOk({ received: true, skipped: "no_page" });
        const result = await applyStripeSubscriptionToPage(supabase, page, subscription, {
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
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subRaw = invoice.subscription;
        const subId = typeof subRaw === "string" ? subRaw : subRaw && typeof subRaw === "object" && "id" in subRaw
          ? (subRaw as { id: string }).id
          : "";
        if (subId) await applyInvoicePaymentFailed(supabase, subId);
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
