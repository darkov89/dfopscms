/** Mapowanie billing_profiles + trial z content — ten sam kontrakt co js/core/billingProfileView.js */

function normalizePageBillingPlan(plan) {
  const raw = plan && String(plan).trim() !== '' ? String(plan).trim().toLowerCase() : 'trial';
  if (raw === 'tier2' || raw === 'premium') return 'tier1';
  return raw;
}

function emptyBillingSubscriptionView() {
  return {
    plan: 'trial',
    status: '',
    payment_completed: false,
    stripe_customer_id: '',
    stripe_subscription_id: '',
    current_period_end: '',
    cancel_at_period_end: false,
    cancel_at: null,
    trial_started_at: null,
    selected_plan: null,
  };
}

/** Plain object — omija Alpine Proxy / getters Supabase przy odczycie pól. */
function snapshotBillingProfileRow(bp) {
  if (bp == null) return null;
  if (typeof bp !== 'object' || Array.isArray(bp)) return null;
  let raw = bp;
  try {
    raw = typeof structuredClone === 'function' ? structuredClone(bp) : JSON.parse(JSON.stringify(bp));
  } catch {
    raw = bp;
  }
  const plan = raw.plan ?? raw['plan'] ?? null;
  const status = raw.status ?? raw['status'] ?? null;
  const stripeSubscriptionId = raw.stripe_subscription_id ?? raw['stripe_subscription_id'] ?? '';
  if (plan == null && status == null && !String(stripeSubscriptionId).trim()) return null;
  return {
    plan,
    status,
    stripe_customer_id: String(raw.stripe_customer_id ?? raw['stripe_customer_id'] ?? '').trim(),
    stripe_subscription_id: String(stripeSubscriptionId).trim(),
    current_period_end: raw.current_period_end ?? raw['current_period_end'] ?? '',
    cancel_at_period_end: raw.cancel_at_period_end === true || raw['cancel_at_period_end'] === true,
  };
}

function billingRowToSubscriptionView(billing, trialSub, pageBillingPlan) {
  const trial = trialSub && typeof trialSub === 'object' ? trialSub : {};
  if (!billing || typeof billing !== 'object' || Array.isArray(billing)) {
    const mirrored = normalizePageBillingPlan(pageBillingPlan);
    if (mirrored === 'tier0' || mirrored === 'tier1') {
      return {
        plan: mirrored,
        trial_started_at: trial.trial_started_at || null,
        selected_plan: trial.selected_plan ?? null,
        payment_completed: true,
        status: 'active',
        stripe_customer_id: '',
        stripe_subscription_id: '',
        current_period_end: '',
        cancel_at_period_end: false,
        cancel_at: trial.cancel_at ?? null,
      };
    }
    return {
      plan: trial.plan || 'trial',
      trial_started_at: trial.trial_started_at || null,
      selected_plan: trial.selected_plan ?? null,
      payment_completed: trial.payment_completed === true,
      status: '',
      stripe_customer_id: '',
      stripe_subscription_id: '',
      current_period_end: '',
      cancel_at_period_end: false,
      cancel_at: trial.cancel_at ?? null,
    };
  }
  const st = String(billing.status || '').trim().toLowerCase();
  const terminated = st === 'canceled' || st === 'cancelled' || st === 'incomplete_expired';
  let plan = terminated ? 'trial' : normalizePageBillingPlan(billing.plan || 'trial');
  const mirrored = normalizePageBillingPlan(pageBillingPlan);
  if ((plan === 'trial' || !billing.plan) && (mirrored === 'tier0' || mirrored === 'tier1')) {
    plan = mirrored;
  }
  const paidTier = !terminated && (plan === 'tier0' || plan === 'tier1');
  const effectiveStatus = st || (paidTier ? 'active' : '');
  return {
    plan,
    status: effectiveStatus,
    stripe_customer_id: billing.stripe_customer_id || '',
    stripe_subscription_id: billing.stripe_subscription_id || '',
    current_period_end: billing.current_period_end || '',
    cancel_at_period_end: billing.cancel_at_period_end === true,
    cancel_at: trial.cancel_at ?? null,
    trial_started_at: trial.trial_started_at,
    selected_plan: trial.selected_plan ?? null,
    payment_completed:
      paidTier &&
      (!st ||
        st === 'active' ||
        st === 'trialing' ||
        st === 'past_due' ||
        st === 'unpaid' ||
        trial.payment_completed === true),
  };
}

/** Jawnie ustawia `ctx.billingSubscriptionView` (Alpine śledzi przypisanie, nie getter). */
function applyBillingSubscriptionView(ctx) {
  const trialSub = ctx.content?.pl?.settings?.subscription;
  const view = billingRowToSubscriptionView(
    snapshotBillingProfileRow(ctx.billingProfile),
    trialSub,
    ctx.pageBillingPlan,
  );
  ctx.billingSubscriptionView = view;
  return view;
}

function stripBillingFromContentSubscription(sub) {
  const trial = sub && typeof sub === 'object' ? sub : {};
  const out = {
    plan: 'trial',
    trial_started_at:
      typeof trial.trial_started_at === 'string' && trial.trial_started_at.trim()
        ? trial.trial_started_at.trim()
        : new Date().toISOString(),
    selected_plan: trial.selected_plan ?? null,
  };
  if (trial.payment_completed === true) out.payment_completed = true;
  return out;
}

function billingDebugEnabledFromLocation() {
  try {
    if (new URLSearchParams(window.location.search).get('billing_debug') === '1') return true;
    return localStorage.getItem('dfcms_billing_debug') === '1';
  } catch {
    return false;
  }
}
