// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

/** Z metadata Checkout (pro | premium) → plan w content (tier1 | tier2). */
function tierPlanFromMetadata(planMeta: string | undefined | null): string {
  const p = String(planMeta || "").toLowerCase().trim();
  if (p === "premium" || p === "tier2") return "tier2";
  if (p === "pro" || p === "tier1") return "tier1";
  return "tier1";
}

function mergeSubscriptionIntoContent(
  content: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...content,
  };
  const plRaw = out.pl;
  const pl =
    plRaw && typeof plRaw === "object" && !Array.isArray(plRaw)
      ? { ...(plRaw as Record<string, unknown>) }
      : {};
  const settingsRaw = pl.settings;
  const settings =
    settingsRaw && typeof settingsRaw === "object" && !Array.isArray(settingsRaw)
      ? { ...(settingsRaw as Record<string, unknown>) }
      : {};
  const oldSubRaw = settings.subscription;
  const oldSub =
    oldSubRaw && typeof oldSubRaw === "object" && !Array.isArray(oldSubRaw)
      ? { ...(oldSubRaw as Record<string, unknown>) }
      : {};
  settings.subscription = { ...oldSub, ...patch };
  pl.settings = settings;
  out.pl = pl;
  return out;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceRole) {
    console.error("stripe-webhook: brak STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
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

  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (session.mode !== "subscription") {
    return new Response(JSON.stringify({ received: true, skipped: "not_subscription" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId =
    (typeof session.client_reference_id === "string" &&
      session.client_reference_id.trim()) ||
    (typeof session.metadata?.supabase_user_id === "string" &&
      session.metadata.supabase_user_id.trim()) ||
    "";

  if (!userId) {
    console.warn("stripe-webhook: checkout.session.completed bez client_reference_id / supabase_user_id");
    return new Response(JSON.stringify({ received: true, skipped: "no_user" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const metadataPlan = session.metadata?.plan;
  const tier = tierPlanFromMetadata(metadataPlan);

  const subId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription && typeof session.subscription === "object" && "id" in session.subscription
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

  const periodEnd = subscription.current_period_end;
  const currentPeriodEnd =
    typeof periodEnd === "number"
      ? new Date(periodEnd * 1000).toISOString()
      : new Date().toISOString();

  const supabase = createClient(supabaseUrl, serviceRole);

  const { data: row, error: fetchErr } = await supabase
    .from("pages")
    .select("id, content")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchErr) {
    console.error("stripe-webhook: select pages", fetchErr);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!row?.id) {
    console.warn("stripe-webhook: brak wiersza pages dla user_id=", userId);
    return new Response(JSON.stringify({ received: true, skipped: "no_page" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const prevContent =
    row.content && typeof row.content === "object" && !Array.isArray(row.content)
      ? (row.content as Record<string, unknown>)
      : {};

  const subPatch: Record<string, unknown> = {
    plan: tier,
    status: "active",
    current_period_end: currentPeriodEnd,
    payment_completed: true,
    selected_plan: tier,
  };

  const newContent = mergeSubscriptionIntoContent(prevContent, subPatch);

  const { error: updErr } = await supabase
    .from("pages")
    .update({
      trial_blocked_at: null,
      billing_failed_at: null,
      content: newContent,
    })
    .eq("id", row.id);

  if (updErr) {
    console.error("stripe-webhook: update pages", updErr);
    return new Response(JSON.stringify({ error: updErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
