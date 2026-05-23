/**
 * Mapowanie billing_profiles + pól trial z content → kształt zgodny z planUtils.
 */
;(function () {
  function billingRowToSubscriptionView(billing, trialSub) {
    const trial = trialSub && typeof trialSub === 'object' ? trialSub : {};
    if (!billing || typeof billing !== 'object') {
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
    const plan = billing.plan || 'trial';
    const st = String(billing.status || '').trim().toLowerCase();
    const paidTier = plan === 'tier0' || plan === 'tier1' || plan === 'tier2';
    return {
      plan,
      status: st,
      stripe_customer_id: billing.stripe_customer_id || '',
      stripe_subscription_id: billing.stripe_subscription_id || '',
      current_period_end: billing.current_period_end || '',
      cancel_at_period_end: billing.cancel_at_period_end === true,
      cancel_at: trial.cancel_at ?? null,
      trial_started_at: trial.trial_started_at,
      selected_plan: trial.selected_plan ?? null,
      payment_completed:
        paidTier &&
        (st === 'active' ||
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
