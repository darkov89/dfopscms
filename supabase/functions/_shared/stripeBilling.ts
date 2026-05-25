/**
 * Rozliczenia Stripe → `billing_profiles` (źródło prawdy).
 * `pages`: wyłącznie `trial_blocked_at`, `billing_failed_at`, `billing_plan` (lustrzany plan dla anon).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";
import type Stripe from "npm:stripe@^14.0.0";

export type StripePaidTier = "tier0" | "tier1";

/** Legacy `tier2` (dawny Premium) → Standard. */
export function normalizeStripePaidTier(plan: string | null | undefined): StripePaidTier {
  const p = String(plan || "").trim().toLowerCase();
  if (p === "tier0" || p === "starter") return "tier0";
  if (p === "tier2" || p === "tier1" || p === "pro" || p === "standard") return "tier1";
  return "tier1";
}

export type BillingProfileRow = {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at?: string;
  updated_at?: string;
};

export type PageRowMini = {
  id: string;
  user_id: string;
  billing_failed_at?: string | null;
  trial_blocked_at?: string | null;
  billing_plan?: string | null;
};

function customerIdString(cust: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): string {
  if (!cust) return "";
  if (typeof cust === "string") return cust;
  if (typeof cust === "object" && "deleted" in cust && cust.deleted) return "";
  if (typeof cust === "object" && "id" in cust && typeof cust.id === "string") return cust.id;
  return "";
}

export type StripePriceEnv = {
  priceStarter: string;
  priceStarterYearly: string;
  pricePro: string;
  priceProYearly: string;
};

/** Identyfikatory cen z Secrets Supabase (miesięczne + roczne). */
export function readStripePriceEnv(): StripePriceEnv {
  return {
    priceStarter: Deno.env.get("STRIPE_PRICE_STARTER") ?? "",
    priceStarterYearly: Deno.env.get("STRIPE_PRICE_STARTER_YEARLY") ?? "",
    pricePro: Deno.env.get("STRIPE_PRICE_PRO") ?? "",
    priceProYearly: Deno.env.get("STRIPE_PRICE_PRO_YEARLY") ?? "",
  };
}

export function applyOptsFromPriceEnv(env: StripePriceEnv): ApplyOpts {
  return {
    priceStarter: env.priceStarter,
    priceStarterYearly: env.priceStarterYearly,
    pricePro: env.pricePro,
    priceProYearly: env.priceProYearly,
  };
}

export function tierOverrideFromPriceId(
  priceId: string,
  env: StripePriceEnv,
): StripePaidTier | undefined {
  if (
    (env.pricePro && priceId === env.pricePro) ||
    (env.priceProYearly && priceId === env.priceProYearly)
  ) {
    return "tier1";
  }
  if (
    (env.priceStarter && priceId === env.priceStarter) ||
    (env.priceStarterYearly && priceId === env.priceStarterYearly)
  ) {
    return "tier0";
  }
  return undefined;
}

export function firstRecurringPriceId(sub: Stripe.Subscription): string {
  const item = sub.items?.data?.[0];
  if (!item?.price) return "";
  const p = item.price;
  return typeof p === "string" ? p : p?.id ?? "";
}

export function tierFromStripePrice(
  priceId: string,
  priceStarter: string,
  priceStarterYearly: string,
  pricePro: string,
  priceProYearly: string,
  fallbackTier: StripePaidTier,
): StripePaidTier {
  if ((pricePro && priceId === pricePro) || (priceProYearly && priceId === priceProYearly)) {
    return "tier1";
  }
  if ((priceStarter && priceId === priceStarter) || (priceStarterYearly && priceId === priceStarterYearly)) {
    return "tier0";
  }
  return normalizeStripePaidTier(fallbackTier);
}

export function priceTierRank(
  priceId: string,
  priceStarter: string,
  priceStarterYearly: string,
  pricePro: string,
  priceProYearly: string,
): number {
  if ((pricePro && priceId === pricePro) || (priceProYearly && priceId === priceProYearly)) return 1;
  if ((priceStarter && priceId === priceStarter) || (priceStarterYearly && priceId === priceStarterYearly)) {
    return 0;
  }
  return 0;
}

function periodEndIso(sub: Stripe.Subscription): string | null {
  const periodEnd = sub.current_period_end;
  if (typeof periodEnd === "number") return new Date(periodEnd * 1000).toISOString();
  return null;
}

export function subscriptionScheduledToCancelStripe(sub: Stripe.Subscription): boolean {
  if (sub.cancel_at_period_end === true) return true;
  const cancelAt = sub.cancel_at;
  if (typeof cancelAt === "number" && cancelAt > Math.floor(Date.now() / 1000)) return true;
  return false;
}

/** Dostęp publiczny (active/trialing lub karencja past_due/unpaid). */
export function subscriptionGrantsPublicAccess(sub: Stripe.Subscription): boolean {
  const st = sub.status;
  if (st === "active" || st === "trialing") return true;
  if (st === "past_due" || st === "unpaid") return true;
  return false;
}

export function subscriptionIsTerminated(sub: Stripe.Subscription): boolean {
  const st = sub.status;
  return st === "canceled" || st === "incomplete_expired" || st === "paused";
}

export type BillingProfileUpsert = {
  user_id: string;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  plan: string;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/** Patch `billing_profiles` z obiektu Subscription Stripe. */
export function billingProfileUpsertFromStripe(
  userId: string,
  sub: Stripe.Subscription,
  tier: StripePaidTier,
): BillingProfileUpsert {
  const cid = customerIdString(sub.customer);
  const st = sub.status;
  const period = periodEndIso(sub);
  const cancelAtPeriodEnd = subscriptionScheduledToCancelStripe(sub);

  if (st === "active" || st === "trialing" || st === "past_due" || st === "unpaid") {
    return {
      user_id: userId,
      stripe_customer_id: cid || null,
      stripe_subscription_id: sub.id,
      plan: tier,
      status: st,
      current_period_end: period,
      cancel_at_period_end: cancelAtPeriodEnd,
    };
  }

  return {
    user_id: userId,
    stripe_customer_id: cid || null,
    stripe_subscription_id: sub.id,
    plan: "trial",
    status: st,
    current_period_end: period,
    cancel_at_period_end: false,
  };
}

export async function findBillingProfileByUserId(
  supabase: SupabaseClient,
  userId: string,
): Promise<BillingProfileRow | null> {
  const { data, error } = await supabase
    .from("billing_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("findBillingProfileByUserId", error);
    return null;
  }
  return data as BillingProfileRow | null;
}

export async function findBillingProfileByStripeSubscriptionId(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<BillingProfileRow | null> {
  const { data, error } = await supabase
    .from("billing_profiles")
    .select("*")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) {
    console.error("findBillingProfileByStripeSubscriptionId", error);
    return null;
  }
  return data as BillingProfileRow | null;
}

export async function findBillingProfileByStripeCustomerId(
  supabase: SupabaseClient,
  customerId: string,
): Promise<BillingProfileRow | null> {
  const { data, error } = await supabase
    .from("billing_profiles")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) {
    console.error("findBillingProfileByStripeCustomerId", error);
    return null;
  }
  return data as BillingProfileRow | null;
}

export async function findPageByUserId(
  supabase: SupabaseClient,
  userId: string,
): Promise<PageRowMini | null> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, user_id, billing_failed_at, trial_blocked_at, billing_plan")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("findPageByUserId", error);
    return null;
  }
  return data as PageRowMini | null;
}

export async function findPageByStripeSubscriptionId(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<PageRowMini | null> {
  const profile = await findBillingProfileByStripeSubscriptionId(supabase, subscriptionId);
  if (!profile?.user_id) return null;
  return findPageByUserId(supabase, profile.user_id);
}

export async function findPageByStripeCustomerId(
  supabase: SupabaseClient,
  customerId: string,
): Promise<PageRowMini | null> {
  const profile = await findBillingProfileByStripeCustomerId(supabase, customerId);
  if (!profile?.user_id) return null;
  return findPageByUserId(supabase, profile.user_id);
}

export async function resolvePageForStripeSubscription(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<PageRowMini | null> {
  const cid = customerIdString(sub.customer);
  if (cid) {
    const byCust = await findPageByStripeCustomerId(supabase, cid);
    if (byCust) return byCust;
  }
  const bySub = await findPageByStripeSubscriptionId(supabase, sub.id);
  if (bySub) return bySub;
  return null;
}

/**
 * Zwalnia unikalne klucze Stripe na innych wierszach — powrót klienta z nową subskrypcją
 * (stary `stripe_subscription_id` w DB nie blokuje upsertu po `user_id`).
 */
async function releaseStaleStripeUniqueKeys(
  supabase: SupabaseClient,
  row: BillingProfileUpsert,
): Promise<void> {
  const subId =
    typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id.trim() : "";
  if (subId) {
    const { error } = await supabase
      .from("billing_profiles")
      .update({ stripe_subscription_id: null })
      .eq("stripe_subscription_id", subId)
      .neq("user_id", row.user_id);
    if (error) {
      console.warn("releaseStaleStripeUniqueKeys subscription", subId, error.message);
    }
  }
  const cid =
    typeof row.stripe_customer_id === "string" ? row.stripe_customer_id.trim() : "";
  if (cid) {
    const { error } = await supabase
      .from("billing_profiles")
      .update({ stripe_customer_id: null })
      .eq("stripe_customer_id", cid)
      .neq("user_id", row.user_id);
    if (error) {
      console.warn("releaseStaleStripeUniqueKeys customer", cid, error.message);
    }
  }
}

/**
 * Zapis / odświeżenie profilu 1:1 po `user_id` — nadpisuje subskrypcję i status (renew / returning).
 */
export async function upsertBillingProfile(
  supabase: SupabaseClient,
  row: BillingProfileUpsert,
): Promise<{ ok: boolean; error?: string }> {
  await releaseStaleStripeUniqueKeys(supabase, row);

  const { error } = await supabase.from("billing_profiles").upsert(row, {
    onConflict: "user_id",
    ignoreDuplicates: false,
  });
  if (error) {
    console.error("Supabase DB Error (upsertBillingProfile):", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function applyPageBlocksForSubscription(
  supabase: SupabaseClient,
  page: PageRowMini,
  sub: Stripe.Subscription,
  plan: string,
): Promise<{ ok: boolean; error?: string }> {
  const st = sub.status;
  const rowUpdate: Record<string, unknown> = { billing_plan: plan };

  if (subscriptionGrantsPublicAccess(sub)) {
    rowUpdate.trial_blocked_at = null;
    if (st === "active" || st === "trialing") {
      rowUpdate.billing_failed_at = null;
    } else if (st === "past_due" || st === "unpaid") {
      if (!page.billing_failed_at) {
        rowUpdate.billing_failed_at = new Date().toISOString();
      }
    }
  } else if (subscriptionIsTerminated(sub)) {
    rowUpdate.billing_plan = "trial";
    rowUpdate.trial_blocked_at = new Date().toISOString();
  }

  const { error: updErr } = await supabase.from("pages").update(rowUpdate).eq("id", page.id);
  if (updErr) {
    console.error("Supabase DB Error (applyPageBlocksForSubscription):", updErr);
    return { ok: false, error: updErr.message };
  }
  return { ok: true };
}

type ApplyOpts = {
  priceStarter?: string;
  priceStarterYearly?: string;
  pricePro: string;
  priceProYearly?: string;
  tierFallback?: StripePaidTier;
  tierOverride?: StripePaidTier;
};

/**
 * Zapisuje subskrypcję w `billing_profiles` + blokuje/odblokowuje `pages`.
 */
export async function applyStripeSubscriptionToPage(
  supabase: SupabaseClient,
  page: PageRowMini,
  sub: Stripe.Subscription,
  opts: ApplyOpts,
): Promise<{ ok: boolean; error?: string }> {
  if (!page.user_id) {
    return { ok: false, error: "Brak user_id na stronie" };
  }

  const profile = await findBillingProfileByUserId(supabase, page.user_id);
  const priceId = firstRecurringPriceId(sub);
  let fallback: StripePaidTier = "tier1";
  const existingPlan = profile?.plan;
  if (existingPlan) fallback = normalizeStripePaidTier(existingPlan);
  if (opts.tierFallback) fallback = normalizeStripePaidTier(opts.tierFallback);

  const priceStarter = opts.priceStarter ?? "";
  const priceStarterYearly = opts.priceStarterYearly ?? "";
  const priceProYearly = opts.priceProYearly ?? "";
  const tier =
    opts.tierOverride ??
    normalizeStripePaidTier(
      tierFromStripePrice(
        priceId,
        priceStarter,
        priceStarterYearly,
        opts.pricePro,
        priceProYearly,
        fallback,
      ),
    );

  const upsertRow = billingProfileUpsertFromStripe(page.user_id, sub, tier);
  const up = await upsertBillingProfile(supabase, upsertRow);
  if (!up.ok) return up;

  return applyPageBlocksForSubscription(supabase, page, sub, upsertRow.plan);
}

export async function applyInvoicePaymentFailed(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const page = await findPageByStripeSubscriptionId(supabase, subscriptionId);
  if (!page?.id) {
    console.warn("applyInvoicePaymentFailed: brak strony dla subscription", subscriptionId);
    return { ok: true };
  }
  if (page.billing_failed_at) return { ok: true };
  const { error } = await supabase
    .from("pages")
    .update({ billing_failed_at: new Date().toISOString() })
    .eq("id", page.id);
  if (error) {
    console.error("Supabase DB Error (applyInvoicePaymentFailed):", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export function extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string {
  const subRaw = invoice.subscription;
  if (typeof subRaw === "string") return subRaw;
  if (subRaw && typeof subRaw === "object" && "id" in subRaw) return (subRaw as { id: string }).id;
  return "";
}

export async function findPageByAuthUserEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<PageRowMini | null> {
  const e = String(email || "").trim();
  if (!e) return null;
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1,
    filter: `email.eq.${e}`,
  });
  if (error) {
    console.error("findPageByAuthUserEmail", error);
    return null;
  }
  const uid = data?.users?.[0]?.id;
  if (!uid) return null;
  return findPageByUserId(supabase, uid);
}

export async function resolvePageForInvoice(
  supabase: SupabaseClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<PageRowMini | null> {
  const subId = extractInvoiceSubscriptionId(invoice);
  if (subId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      const page = await resolvePageForStripeSubscription(supabase, sub);
      if (page) return page;
    } catch (err) {
      console.warn("resolvePageForInvoice subscription", subId, err);
    }
    const pageBySub = await findPageByStripeSubscriptionId(supabase, subId);
    if (pageBySub) return pageBySub;
  }

  const custRef = invoice.customer;
  const custId =
    typeof custRef === "string"
      ? custRef
      : custRef && typeof custRef === "object" && "id" in custRef
        ? (custRef as { id: string }).id
        : "";

  if (custId) {
    const byCust = await findPageByStripeCustomerId(supabase, custId);
    if (byCust) return byCust;
    try {
      const cust = await stripe.customers.retrieve(custId);
      if (
        cust &&
        typeof cust !== "string" &&
        !("deleted" in cust && (cust as Stripe.DeletedCustomer).deleted) &&
        "email" in cust &&
        typeof (cust as Stripe.Customer).email === "string" &&
        (cust as Stripe.Customer).email
      ) {
        const byMail = await findPageByAuthUserEmail(supabase, (cust as Stripe.Customer).email!);
        if (byMail) return byMail;
      }
    } catch (err) {
      console.warn("resolvePageForInvoice customer", custId, err);
    }
  }

  if (invoice.customer_email) {
    return findPageByAuthUserEmail(supabase, invoice.customer_email);
  }
  return null;
}

export async function applyInvoiceRenewalPaymentFailed(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const page = await findPageByStripeSubscriptionId(supabase, subscriptionId);
  if (!page?.id) {
    console.warn("applyInvoiceRenewalPaymentFailed: brak strony dla subscription", subscriptionId);
    return { ok: true };
  }
  const { error } = await supabase
    .from("pages")
    .update({ billing_failed_at: new Date().toISOString() })
    .eq("id", page.id);
  if (error) {
    console.error("Supabase DB Error (applyInvoiceRenewalPaymentFailed):", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function applySubscriptionCanceledToPage(
  supabase: SupabaseClient,
  page: PageRowMini,
  sub: Stripe.Subscription,
): Promise<{ ok: boolean; error?: string }> {
  if (!page.user_id) {
    return { ok: false, error: "Brak user_id na stronie" };
  }
  const cid = customerIdString(sub.customer);
  const upsertRow: BillingProfileUpsert = {
    user_id: page.user_id,
    stripe_customer_id: cid || null,
    stripe_subscription_id: sub.id,
    plan: "trial",
    status: "canceled",
    current_period_end: periodEndIso(sub),
    cancel_at_period_end: false,
  };
  const up = await upsertBillingProfile(supabase, upsertRow);
  if (!up.ok) return up;

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("pages")
    .update({
      billing_plan: "trial",
      trial_blocked_at: nowIso,
    })
    .eq("id", page.id);

  if (updErr) {
    console.error("Supabase DB Error (applySubscriptionCanceledToPage):", updErr);
    return { ok: false, error: updErr.message };
  }
  return { ok: true };
}
