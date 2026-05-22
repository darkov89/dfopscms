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

export type StripePaidTier = "tier0" | "tier1" | "tier2";

/** Mapowanie price_id z Secrets → tier (Starter / Pro / Premium). */
export function tierFromStripePrice(
  priceId: string,
  priceStarter: string,
  pricePro: string,
  pricePremium: string,
  fallbackTier: StripePaidTier,
): StripePaidTier {
  if (pricePremium && priceId === pricePremium) return "tier2";
  if (pricePro && priceId === pricePro) return "tier1";
  if (priceStarter && priceId === priceStarter) return "tier0";
  return fallbackTier;
}

/** Wykrywanie rangi planu wg ID cen (0 = Starter / nieznany, 1 = Pro, 2 = Premium). */
export function priceTierRank(
  priceId: string,
  priceStarter: string,
  pricePro: string,
  pricePremium: string,
): number {
  if (pricePremium && priceId === pricePremium) return 2;
  if (pricePro && priceId === pricePro) return 1;
  if (priceStarter && priceId === priceStarter) return 0;
  return 0;
}

/** `content.pl.settings.subscription` z JSON strony (bez pełnego typowania content). */
export function subscriptionObjFromContent(
  content: unknown,
): Record<string, unknown> | undefined {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return undefined;
  }
  const pl = (content as Record<string, unknown>).pl;
  if (!pl || typeof pl !== "object") return undefined;
  const settings = (pl as Record<string, unknown>).settings;
  if (!settings || typeof settings !== "object") return undefined;
  const sub = (settings as Record<string, unknown>).subscription;
  if (!sub || typeof sub !== "object") return undefined;
  return sub as Record<string, unknown>;
}

/** Koniec bieżącego okresu rozliczeniowego — wyłącznie z obiektu Subscription API (źródło prawdy Stripe). */
function periodEndIso(sub: Stripe.Subscription): string {
  const periodEnd = sub.current_period_end;
  if (typeof periodEnd === "number") return new Date(periodEnd * 1000).toISOString();
  return new Date().toISOString();
}

/** Rezygnacja zaplanowana: koniec okresu lub przyszły `cancel_at` (Customer Portal). */
export function subscriptionScheduledToCancelStripe(sub: Stripe.Subscription): boolean {
  if (sub.cancel_at_period_end === true) return true;
  const cancelAt = sub.cancel_at;
  if (typeof cancelAt === "number" && cancelAt > Math.floor(Date.now() / 1000)) return true;
  return false;
}

function cancelAtIso(sub: Stripe.Subscription): string | undefined {
  const cancelAt = sub.cancel_at;
  if (typeof cancelAt !== "number") return undefined;
  return new Date(cancelAt * 1000).toISOString();
}

/**
 * Składa patch dla `content.pl.settings.subscription` wg statusu Stripe.
 */
export function subscriptionContentPatch(
  sub: Stripe.Subscription,
  tier: StripePaidTier,
): Record<string, unknown> {
  const cid = customerIdString(sub.customer);
  const st = sub.status;
  const period = periodEndIso(sub);
  const cancelAtPeriodEnd = subscriptionScheduledToCancelStripe(sub);
  const cancelAt = cancelAtIso(sub);

  const base: Record<string, unknown> = {
    ...(cid ? { stripe_customer_id: cid } : {}),
    stripe_subscription_id: sub.id,
    status: st,
    current_period_end: period,
    cancel_at_period_end: cancelAtPeriodEnd,
    ...(cancelAt ? { cancel_at: cancelAt } : {}),
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
    cancel_at_period_end: false,
    cancel_at: null,
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
  /** Opcjonalny Secret STRIPE_PRICE_STARTER — bez niego Starter z checkoutu mapuje się z metadata / fallback. */
  priceStarter?: string;
  pricePro: string;
  pricePremium: string;
  /** Gdy brak price match (np. zmiana cennika) — ostatnia znana wartość z content / checkout. */
  tierFallback?: StripePaidTier;
  /** Nadpisanie tieru (np. świeży checkout — metadata ma pierwszeństwo przed price_id). */
  tierOverride?: StripePaidTier;
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
  let fallback: StripePaidTier = "tier1";
  if (existingTier?.plan === "tier2" || existingTier?.selected_plan === "tier2") fallback = "tier2";
  else if (existingTier?.plan === "tier0" || existingTier?.selected_plan === "tier0") fallback = "tier0";
  if (opts.tierFallback === "tier2") fallback = "tier2";
  if (opts.tierFallback === "tier0") fallback = "tier0";
  if (opts.tierFallback === "tier1") fallback = "tier1";
  const priceStarter = opts.priceStarter ?? "";
  const tier =
    opts.tierOverride ??
    tierFromStripePrice(
      priceId,
      priceStarter,
      opts.pricePro,
      opts.pricePremium,
      fallback,
    );
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

export function extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string {
  const subRaw = invoice.subscription;
  if (typeof subRaw === "string") return subRaw;
  if (subRaw && typeof subRaw === "object" && "id" in subRaw) return (subRaw as { id: string }).id;
  return "";
}

/**
 * Wyszukanie strony po adresie e-mail konta Auth (service_role).
 * Filter: email.eq.{email} (GoTrue admin API).
 */
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

/**
 * Rozwiązuje `pages` po fakturze: subscription → customer w JSON → customer w Stripe → e-mail.
 */
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
    return await findPageByAuthUserEmail(supabase, invoice.customer_email);
  }
  return null;
}

/** Nieudana opłata przy odnowieniu / zmianie cyklu — ustawia billing_failed_at (karencja przed cronem). */
export async function applyInvoiceRenewalPaymentFailed(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<void> {
  const page = await findPageByStripeSubscriptionId(supabase, subscriptionId);
  if (!page?.id) {
    console.warn("applyInvoiceRenewalPaymentFailed: brak strony dla subscription", subscriptionId);
    return;
  }
  await supabase
    .from("pages")
    .update({ billing_failed_at: new Date().toISOString() })
    .eq("id", page.id);
}

/**
 * `customer.subscription.deleted` — anulowana subskrypcja w Stripe: brak aktywnego planu płatnego w CMS.
 */
export async function applySubscriptionCanceledToPage(
  supabase: SupabaseClient,
  page: PageRowMini,
  sub: Stripe.Subscription,
): Promise<{ ok: boolean; error?: string }> {
  const cid = customerIdString(sub.customer);
  const patch: Record<string, unknown> = {
    ...(cid ? { stripe_customer_id: cid } : {}),
    stripe_subscription_id: sub.id,
    status: "canceled",
    plan: "trial",
    payment_completed: false,
    selected_plan: null,
    current_period_end: periodEndIso(sub),
    cancel_at_period_end: false,
    cancel_at: null,
  };

  const prevContent =
    page.content && typeof page.content === "object" && !Array.isArray(page.content)
      ? (page.content as Record<string, unknown>)
      : {};
  const newContent = mergeSubscriptionIntoContent(prevContent, patch);

  const { error: updErr } = await supabase
    .from("pages")
    .update({
      content: newContent,
    })
    .eq("id", page.id);

  if (updErr) {
    console.error("applySubscriptionCanceledToPage", updErr);
    return { ok: false, error: updErr.message };
  }
  return { ok: true };
}
