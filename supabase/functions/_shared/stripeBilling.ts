/**
 * Wspólna logika merge subskrypcji w `content` + aktualizacja `pages` (blokady trial / billing).
 * Używana przez stripe-webhook i sync-stripe-subscription.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

export function mergeSubscriptionIntoContent(
  content: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...content };
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

function customerIdString(cust: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): string {
  if (!cust) return "";
  if (typeof cust === "string") return cust;
  if (typeof cust === "object" && "deleted" in cust && cust.deleted) return "";
  if (typeof cust === "object" && "id" in cust && typeof cust.id === "string") return cust.id;
  return "";
}

export function firstRecurringPriceId(sub: Stripe.Subscription): string {
  const item = sub.items?.data?.[0];
  if (!item?.price) return "";
  const p = item.price;
  return typeof p === "string" ? p : p?.id ?? "";
}

/** Mapowanie price_id z Secrets → tier (Checkout używa tylko Pro/Premium). */
export function tierFromStripePrice(
  priceId: string,
  pricePro: string,
  pricePremium: string,
  fallbackTier: "tier1" | "tier2",
): "tier1" | "tier2" {
  if (pricePremium && priceId === pricePremium) return "tier2";
  if (pricePro && priceId === pricePro) return "tier1";
  return fallbackTier;
}

function periodEndIso(sub: Stripe.Subscription): string {
  const periodEnd = sub.current_period_end;
  if (typeof periodEnd === "number") return new Date(periodEnd * 1000).toISOString();
  return new Date().toISOString();
}

/**
 * Składa patch dla `content.pl.settings.subscription` wg statusu Stripe.
 */
export function subscriptionContentPatch(
  sub: Stripe.Subscription,
  tier: "tier1" | "tier2",
): Record<string, unknown> {
  const cid = customerIdString(sub.customer);
  const st = sub.status;
  const period = periodEndIso(sub);

  const base: Record<string, unknown> = {
    ...(cid ? { stripe_customer_id: cid } : {}),
    stripe_subscription_id: sub.id,
    status: st,
    current_period_end: period,
  };

  if (st === "active" || st === "trialing") {
    return {
      ...base,
      plan: tier,
      payment_completed: true,
      selected_plan: tier,
    };
  }
  if (st === "past_due" || st === "unpaid") {
    return {
      ...base,
      plan: tier,
      payment_completed: true,
      selected_plan: tier,
    };
  }
  /** canceled, incomplete, incomplete_expired, … */
  return {
    ...base,
    plan: "trial",
    payment_completed: false,
    selected_plan: null,
  };
}

export type PageRowMini = {
  id: string;
  content: unknown;
  billing_failed_at?: string | null;
  trial_blocked_at?: string | null;
};

export async function findPageByStripeSubscriptionId(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<PageRowMini | null> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, content, billing_failed_at, trial_blocked_at")
    .eq("content->pl->settings->subscription->>stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) {
    console.error("findPageByStripeSubscriptionId", error);
    return null;
  }
  return data as PageRowMini | null;
}

export async function findPageByStripeCustomerId(
  supabase: SupabaseClient,
  customerId: string,
): Promise<PageRowMini | null> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, content, billing_failed_at, trial_blocked_at")
    .eq("content->pl->settings->subscription->>stripe_customer_id", customerId)
    .maybeSingle();
  if (error) {
    console.error("findPageByStripeCustomerId", error);
    return null;
  }
  return data as PageRowMini | null;
}

export async function findPageByUserId(
  supabase: SupabaseClient,
  userId: string,
): Promise<PageRowMini | null> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, content, billing_failed_at, trial_blocked_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("findPageByUserId", error);
    return null;
  }
  return data as PageRowMini | null;
}

/** Łączy znalezienie strony: sub_id → customer_id. */
export async function resolvePageForStripeSubscription(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<PageRowMini | null> {
  const bySub = await findPageByStripeSubscriptionId(supabase, sub.id);
  if (bySub) return bySub;
  const cid = customerIdString(sub.customer);
  if (!cid) return null;
  return await findPageByStripeCustomerId(supabase, cid);
}

type ApplyOpts = {
  pricePro: string;
  pricePremium: string;
  /** Gdy brak price match (np. zmiana cennika) — ostatnia znana wartość z content / checkout. */
  tierFallback?: "tier1" | "tier2";
  /** Nadpisanie tieru (np. świeży checkout — metadata ma pierwszeństwo przed price_id). */
  tierOverride?: "tier1" | "tier2";
};

/**
 * Aktualizuje `content` + opcjonalnie `trial_blocked_at` / `billing_failed_at`.
 */
export async function applyStripeSubscriptionToPage(
  supabase: SupabaseClient,
  page: PageRowMini,
  sub: Stripe.Subscription,
  opts: ApplyOpts,
): Promise<{ ok: boolean; error?: string }> {
  const priceId = firstRecurringPriceId(sub);
  const existingTier =
    page.content &&
    typeof page.content === "object" &&
    !Array.isArray(page.content) &&
    (page.content as Record<string, unknown>).pl &&
    typeof (page.content as Record<string, unknown>).pl === "object"
      ? (((page.content as Record<string, unknown>).pl as Record<string, unknown>).settings as Record<
          string,
          unknown
        > | undefined)?.subscription as Record<string, unknown> | undefined
      : undefined;
  let fallback: "tier1" | "tier2" = "tier1";
  if (existingTier?.plan === "tier2" || existingTier?.selected_plan === "tier2") fallback = "tier2";
  if (opts.tierFallback === "tier2") fallback = "tier2";
  const tier =
    opts.tierOverride ??
    tierFromStripePrice(priceId, opts.pricePro, opts.pricePremium, fallback);
  const patch = subscriptionContentPatch(sub, tier);

  const prevContent =
    page.content && typeof page.content === "object" && !Array.isArray(page.content)
      ? (page.content as Record<string, unknown>)
      : {};

  const newContent = mergeSubscriptionIntoContent(prevContent, patch);

  const st = sub.status;
  const rowUpdate: Record<string, unknown> = { content: newContent };

  if (st === "active" || st === "trialing") {
    rowUpdate.trial_blocked_at = null;
    rowUpdate.billing_failed_at = null;
  } else if (st === "past_due" || st === "unpaid") {
    if (!page.billing_failed_at) {
      rowUpdate.billing_failed_at = new Date().toISOString();
    }
  }

  const { error: updErr } = await supabase.from("pages").update(rowUpdate).eq("id", page.id);
  if (updErr) {
    console.error("applyStripeSubscriptionToPage", updErr);
    return { ok: false, error: updErr.message };
  }
  return { ok: true };
}

/** Pierwsza nieudana faktura — znacznik okresu karencji przed blokadą publiczną. */
export async function applyInvoicePaymentFailed(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<void> {
  const page = await findPageByStripeSubscriptionId(supabase, subscriptionId);
  if (!page?.id) {
    console.warn("applyInvoicePaymentFailed: brak strony dla subscription", subscriptionId);
    return;
  }
  if (page.billing_failed_at) return;
  await supabase
    .from("pages")
    .update({ billing_failed_at: new Date().toISOString() })
    .eq("id", page.id);
}
