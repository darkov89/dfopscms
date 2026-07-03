/**
 * Mapowanie billing_profiles + pól trial z content → kształt zgodny z planUtils.
 */
;(function () {
  function normalizePageBillingPlan(plan) {
    const raw = plan && String(plan).trim() !== '' ? String(plan).trim().toLowerCase() : 'trial';
    if (raw === 'tier2' || raw === 'premium') return 'tier1';
    return raw;
  }

  /**
   * @param {object|null} billing — wiersz `billing_profiles`
   * @param {object|null} trialSub — `content.pl.settings.subscription` (tylko trial)
   * @param {string|null|undefined} pageBillingPlan — lustrzane `pages.billing_plan` (fallback gdy brak profilu / God Mode)
   */
  function billingRowToSubscriptionView(billing, trialSub, pageBillingPlan) {
    const trial = trialSub && typeof trialSub === 'object' ? trialSub : {};
    if (!billing || typeof billing !== 'object') {
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

  /** Zostaw w JSON tylko pola trial (bez ID Stripe / statusów). */
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

  window.DFOPS_billingRowToSubscriptionView = billingRowToSubscriptionView;
  window.DFOPS_stripBillingFromContentSubscription = stripBillingFromContentSubscription;
})();
