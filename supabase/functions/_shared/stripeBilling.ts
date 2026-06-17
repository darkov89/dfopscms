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

function billingProfileStatusNormalized(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

/** Aktywna subskrypcja w billing_profiles (źródło prawdy po płatności). */
export function billingProfileHasLiveSubscription(profile: BillingProfileRow | null): boolean {
  const st = billingProfileStatusNormalized(profile?.status ?? null);
  return st === "active" || st === "trialing";
}

/**
 * Źródło prawdy przy kolejce webhooków: inna sub active/trialing u tego klienta w Stripe
 * (nie polegaj wyłącznie na billing_profiles — może być opóźnione względem checkout).
 */
export async function stripeCustomerHasLiveSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<boolean> {
  const cid = customerId.trim();
  if (!cid) return false;
  try {
    for (const status of ["active", "trialing"] as const) {
      const { data } = await stripe.subscriptions.list({
        customer: cid,
        status,
        limit: 1,
      });
      if (data.length > 0) return true;
    }
  } catch (e) {
    console.warn("stripeCustomerHasLiveSubscription", cid, e);
  }
  return false;
}

/** Wymuszone odblokowanie pages po udanej płatności (dual SoT → pages musi być czyste). */
export async function clearPageBillingBlocksForPaidUser(
  supabase: SupabaseClient,
  userId: string,
  plan: string,
): Promise<{ ok: boolean; error?: string }> {
  const uid = userId.trim();
  if (!uid) return { ok: false, error: "Brak user_id" };
  const { error } = await supabase
    .from("pages")
    .update({
      billing_plan: plan,
      trial_blocked_at: null,
      billing_failed_at: null,
    })
    .eq("user_id", uid);
  if (error) {
    console.error("Supabase DB Error (clearPageBillingBlocksForPaidUser):", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Webhook obniżający status — podatny na opóźnione zdarzenia o poprzedniej subskrypcji. */
function isDowngradeBillingStatus(status: string | null | undefined): boolean {
  const st = String(status ?? "").trim().toLowerCase();
  return st === "canceled" || st === "cancelled" || st === "past_due";
}

export type ZombieGuardResult = {
  killed: boolean;
  currentProfile: BillingProfileRow | null;
};

/**
 * Tarcza anty-zombie (źródło prawdy: `billing_profiles` w DB).
 * Zanim upsert / `trial_blocked_at` — jeśli profil jest zdrowy (active/trialing)
 * i dotyczy INNEJ sub niż event, przerwij (opóźniony cancel/update starej sub).
 *
 * `incomingIsLive`: true gdy przychodząca sub jest active/trialing (nowa płatność) — nie zabijaj.
 */
export async function killZombieSubscriptionEvent(
  supabase: SupabaseClient,
  userId: string,
  incomingSubscriptionId: string,
  incomingIsLive = false,
): Promise<ZombieGuardResult> {
  const uid = userId.trim();
  const incomingSubId = String(incomingSubscriptionId || "").trim();
  if (!uid || !incomingSubId) {
    return { killed: false, currentProfile: null };
  }

  const { data, error } = await supabase
    .from("billing_profiles")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    console.warn("killZombieSubscriptionEvent lookup:", error.message);
    return { killed: false, currentProfile: null };
  }

  const currentProfile = (data as BillingProfileRow | null) ?? null;
  const currentSubId =
    typeof currentProfile?.stripe_subscription_id === "string"
      ? currentProfile.stripe_subscription_id.trim()
      : "";

  if (!currentProfile || !currentSubId || currentSubId === incomingSubId) {
    return { killed: false, currentProfile };
  }

  if (incomingIsLive) {
    return { killed: false, currentProfile };
  }

  if (billingProfileHasLiveSubscription(currentProfile)) {
    console.log(
      `ZOMBIE KILLED: Ignoruję event dla starej subskrypcji (event=${incomingSubId}, aktywna=${currentSubId})`,
    );
    return { killed: true, currentProfile };
  }

  return { killed: false, currentProfile };
}

/**
 * @deprecated Użyj `killZombieSubscriptionEvent` — zachowane dla kompatybilności wywołań.
 */
export async function shouldIgnoreStaleBillingDowngradeWebhook(
  supabase: SupabaseClient,
  userId: string,
  incomingSubscriptionId: string,
  incomingStatus: string | null | undefined,
): Promise<boolean> {
  if (!userId || !isDowngradeBillingStatus(incomingStatus)) return false;
  const { killed } = await killZombieSubscriptionEvent(
    supabase,
    userId,
    incomingSubscriptionId,
    false,
  );
  return killed;
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
    .limit(1)
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
  if (!page.user_id) {
    return { ok: false, error: "Brak user_id na stronie" };
  }

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

  const { error: updErr } = await supabase
    .from("pages")
    .update(rowUpdate)
    .eq("user_id", page.user_id);
  if (updErr) {
    console.error("Supabase DB Error (applyPageBlocksForSubscription):", updErr);
    return { ok: false, error: updErr.message };
  }
  return { ok: true };
}

/**
 * Po `upsertBillingProfile` — lustrzane odblokowanie `pages` (nie tylko billing_profiles).
 * Przy active/trialing zawsze czyści blokady (renew / powracający klient).
 */
async function syncPageBillingMirrorFromProfile(
  supabase: SupabaseClient,
  page: PageRowMini,
  upsertRow: BillingProfileUpsert,
  sub: Stripe.Subscription,
): Promise<{ ok: boolean; error?: string }> {
  if (!page.user_id) {
    return { ok: false, error: "Brak user_id na stronie" };
  }

  const st = String(upsertRow.status ?? sub.status ?? "").trim().toLowerCase();
  const plan = upsertRow.plan;

  if (st === "active" || st === "trialing") {
    return clearPageBillingBlocksForPaidUser(supabase, page.user_id, plan);
  }

  return applyPageBlocksForSubscription(supabase, page, sub, plan);
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

  const subStatus = String(sub.status ?? "").trim().toLowerCase();
  const incomingIsLive = subStatus === "active" || subStatus === "trialing";

  const zombie = await killZombieSubscriptionEvent(
    supabase,
    page.user_id,
    sub.id,
    incomingIsLive,
  );
  if (zombie.killed) {
    return { ok: true };
  }

  const profile = zombie.currentProfile ?? (await findBillingProfileByUserId(supabase, page.user_id));
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
  const upsertStatus = String(upsertRow.status ?? sub.status ?? "").trim().toLowerCase();

  if (!incomingIsLive && isDowngradeBillingStatus(upsertStatus)) {
    const downgradeZombie = await killZombieSubscriptionEvent(
      supabase,
      page.user_id,
      sub.id,
      false,
    );
    if (downgradeZombie.killed) {
      return { ok: true };
    }
  }

  const up = await upsertBillingProfile(supabase, upsertRow);
  if (!up.ok) return up;

  if (upsertStatus === "active" || upsertStatus === "trialing") {
    const healed = await clearPageBillingBlocksForPaidUser(supabase, page.user_id, tier);
    if (!healed.ok) return healed;
    return { ok: true };
  }

  return syncPageBillingMirrorFromProfile(supabase, page, upsertRow, sub);
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

type InvoiceParentLike = {
  type?: string;
  subscription_details?: {
    subscription?: string | { id: string } | null;
  } | null;
};

function subscriptionIdFromRef(
  ref: string | { id: string } | null | undefined,
): string {
  if (typeof ref === "string" && ref.trim()) return ref.trim();
  if (ref && typeof ref === "object" && "id" in ref && typeof ref.id === "string") {
    return ref.id.trim();
  }
  return "";
}

/**
 * ID subskrypcji z Invoice (legacy `subscription` + Basil `parent.subscription_details`).
 * Webhooki Stripe często nie mają już top-level `invoice.subscription`.
 */
export function extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string {
  const fromTop = subscriptionIdFromRef(
    invoice.subscription as string | { id: string } | null | undefined,
  );
  if (fromTop) return fromTop;

  const invExt = invoice as Stripe.Invoice & {
    parent?: InvoiceParentLike;
    subscription_details?: InvoiceParentLike["subscription_details"];
  };

  const parent = invExt.parent;
  if (parent?.type === "subscription_details") {
    const fromParent = subscriptionIdFromRef(parent.subscription_details?.subscription);
    if (fromParent) return fromParent;
  }

  const fromDetails = subscriptionIdFromRef(invExt.subscription_details?.subscription);
  if (fromDetails) return fromDetails;

  const lines = invoice.lines?.data ?? [];
  for (const line of lines) {
    const lineExt = line as {
      subscription?: string | { id: string };
      parent?: InvoiceParentLike;
    };
    const fromLine = subscriptionIdFromRef(lineExt.subscription);
    if (fromLine) return fromLine;
    if (lineExt.parent?.type === "subscription_details") {
      const fromLineParent = subscriptionIdFromRef(
        lineExt.parent.subscription_details?.subscription,
      );
      if (fromLineParent) return fromLineParent;
    }
  }

  return "";
}

/** Gdy webhook nie zawiera sub id — dociągnij pełną fakturę z API Stripe. */
export async function resolveInvoiceSubscriptionId(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<string> {
  let id = extractInvoiceSubscriptionId(invoice);
  if (id) return id;
  const invoiceId = typeof invoice.id === "string" ? invoice.id.trim() : "";
  if (!invoiceId) return "";

  try {
    const full = await stripe.invoices.retrieve(invoiceId, {
      expand: ["subscription", "lines.data.subscription"],
    });
    id = extractInvoiceSubscriptionId(full);
    if (id) return id;
  } catch (e) {
    console.warn("resolveInvoiceSubscriptionId retrieve", invoiceId, e);
  }

  const custId = customerIdString(
    invoice.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
  );
  if (custId) {
    try {
      for (const status of ["active", "trialing"] as const) {
        const { data } = await stripe.subscriptions.list({
          customer: custId,
          status,
          limit: 1,
        });
        if (data[0]?.id) return data[0].id;
      }
    } catch (e) {
      console.warn("resolveInvoiceSubscriptionId list subs", custId, e);
    }
  }

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

export type ApplySubscriptionCanceledOpts = {
  stripe?: Stripe;
};

/**
 * Wyścig kolejki: starsze `deleted` mogło ustawić `trial_blocked_at` zanim checkout/invoice odblokowało profil.
 * Przy pominięciu cancel — wyrównaj `pages` do aktywnego `billing_profiles`.
 */
async function healPageBlocksIfBillingProfileLive(
  supabase: SupabaseClient,
  page: PageRowMini,
  profile: BillingProfileRow | null,
  reason: string,
): Promise<void> {
  if (!page.user_id || !billingProfileHasLiveSubscription(profile)) return;
  const blocked = page.trial_blocked_at || page.billing_failed_at;
  const planOnPage = String(page.billing_plan ?? "").trim().toLowerCase();
  const paidOnPage = planOnPage === "tier0" || planOnPage === "tier1";
  if (!blocked && paidOnPage) return;

  const plan = normalizeStripePaidTier(profile?.plan ?? (planOnPage || "tier1"));
  const healed = await clearPageBillingBlocksForPaidUser(supabase, page.user_id, plan);
  if (healed.ok) {
    console.log(
      JSON.stringify({
        tag: "stripe-webhook-queue",
        phase: "heal",
        reason,
        user_id: page.user_id,
        billing_plan: plan,
      }),
    );
  }
}

export async function applySubscriptionCanceledToPage(
  supabase: SupabaseClient,
  page: PageRowMini,
  sub: Stripe.Subscription,
  opts?: ApplySubscriptionCanceledOpts,
): Promise<{ ok: boolean; error?: string }> {
  if (!page.user_id) {
    return { ok: false, error: "Brak user_id na stronie" };
  }

  const zombie = await killZombieSubscriptionEvent(supabase, page.user_id, sub.id, false);
  if (zombie.killed) {
    await healPageBlocksIfBillingProfileLive(
      supabase,
      page,
      zombie.currentProfile,
      "zombie_killed_before_cancel",
    );
    return { ok: true };
  }

  const cid = customerIdString(sub.customer);
  if (opts?.stripe && cid) {
    if (await stripeCustomerHasLiveSubscription(opts.stripe, cid)) {
      console.log(
        `ZOMBIE QUEUE: klient ${cid} ma aktywną sub w Stripe — ignoruję cancel/deleted ${sub.id}`,
      );
      const profile =
        zombie.currentProfile ?? (await findBillingProfileByUserId(supabase, page.user_id));
      await healPageBlocksIfBillingProfileLive(supabase, page, profile, "stripe_live_subscription");
      return { ok: true };
    }
  }

  const profile =
    zombie.currentProfile ?? (await findBillingProfileByUserId(supabase, page.user_id));
  const dbSubId =
    typeof profile?.stripe_subscription_id === "string"
      ? profile.stripe_subscription_id.trim()
      : "";
  const dbSt = billingProfileStatusNormalized(profile?.status ?? null);

  if (dbSubId === sub.id && (dbSt === "canceled" || dbSt === "cancelled")) {
    console.log("applySubscriptionCanceled: idempotent — profil już canceled dla", sub.id);
    return { ok: true };
  }

  const preWriteZombie = await killZombieSubscriptionEvent(supabase, page.user_id, sub.id, false);
  if (preWriteZombie.killed) {
    await healPageBlocksIfBillingProfileLive(
      supabase,
      page,
      preWriteZombie.currentProfile,
      "zombie_killed_pre_upsert",
    );
    return { ok: true };
  }

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

  const preBlockZombie = await killZombieSubscriptionEvent(supabase, page.user_id, sub.id, false);
  if (preBlockZombie.killed) {
    await healPageBlocksIfBillingProfileLive(
      supabase,
      page,
      preBlockZombie.currentProfile,
      "zombie_killed_pre_trial_block",
    );
    return { ok: true };
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("pages")
    .update({
      billing_plan: "trial",
      trial_blocked_at: nowIso,
    })
    .eq("user_id", page.user_id);

  if (updErr) {
    console.error("Supabase DB Error (applySubscriptionCanceledToPage):", updErr);
    return { ok: false, error: updErr.message };
  }
  return { ok: true };
}
