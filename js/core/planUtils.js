;(function () {
  /**
   * Jedna „prawda” o planie: domena, znak wodny (publiczny widok).
   */
  function normalizePlan(plan) {
    return plan && String(plan).trim() !== '' ? String(plan).trim() : 'trial';
  }

  function planAllowsCustomDomain(plan) {
    const p = normalizePlan(plan);
    return p !== 'trial' && p !== 'tier0';
  }

  function planShowsWatermark(plan) {
    const p = normalizePlan(plan);
    return p === 'trial' || p === 'tier0';
  }

  function planDisplayName(plan) {
    const p = normalizePlan(plan);
    if (p === 'trial') return 'Okres próbny (14 dni)';
    if (p === 'tier0') return 'Starter — 19 zł netto / msc';
    if (p === 'tier1') return 'Pro — 49 zł netto / msc';
    if (p === 'tier2') return 'Premium — 99 zł netto / msc';
    if (p === 'tier_custom' || p === 'custom') return 'Custom / Concierge';
    return p;
  }

  /** Pełny opis z uwzględnieniem wybranego pakietu w trialu (przed pierwszą opłatą). */
  function subscriptionDisplayName(sub) {
    if (!sub || typeof sub !== 'object') return 'Okres próbny (14 dni)';
    const p = normalizePlan(sub.plan);
    const sel = sub.selected_plan ? normalizePlan(sub.selected_plan) : '';
    if (p === 'trial') {
      if (sel === 'tier0') return 'Okres próbny — wybrany Starter (dokończ opłatę)';
      if (sel === 'tier1') return 'Okres próbny — wybrany Pro (dokończ płatność)';
      if (sel === 'tier2') return 'Okres próbny — wybrany Premium (dokończ płatność)';
      return 'Okres próbny (14 dni)';
    }
    return planDisplayName(p);
  }

  function planCapabilitiesSummary(plan) {
    const p = normalizePlan(plan);
    const domain = planAllowsCustomDomain(p) ? 'Własna domena: tak' : 'Własna domena: .dfcms.pl (od Pro: .pl/.com)';
    const wm = planShowsWatermark(p) ? 'Logo DFCMS w stopce' : 'Bez logo DFCMS';
    const colors =
      p === 'trial' || p === 'tier0'
        ? 'Kolory: podstawowy preset'
        : 'Kolory: wszystkie presety';
    const assistant =
      p === 'tier2'
        ? 'Asystent: 1 h/msc w cenie'
        : p === 'tier1'
          ? 'Asystent: 100 zł/h netto'
          : 'Asystent: od Pro';
    return `${domain} · ${wm} · ${colors} · ${assistant}`;
  }

  function subscriptionStripeStatus(sub) {
    if (!sub || typeof sub !== 'object') return '';
    return String(sub.status || '')
      .trim()
      .toLowerCase();
  }

  /** Stripe: subskrypcja zakończona — nie pokazuj jako „aktywna” nawet gdy `plan` w JSON zalega tier*. */
  function subscriptionStripeStatusTerminal(sub) {
    const st = subscriptionStripeStatus(sub);
    return st === 'canceled' || st === 'cancelled' || st === 'incomplete_expired';
  }

  /**
   * Anulowanie na koniec okresu w Stripe (`cancel_at_period_end`) — w JSON czasem boolean, czasem string.
   */
  function subscriptionCancelAtPeriodEndTrue(sub) {
    if (!sub || typeof sub !== 'object') return false;
    const v = sub.cancel_at_period_end;
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  /** Zaplanowane zamknięcie: `cancel_at_period_end` lub przyszły `cancel_at` (portal Stripe). */
  function subscriptionScheduledToCancel(sub) {
    if (!sub || typeof sub !== 'object') return false;
    if (subscriptionCancelAtPeriodEndTrue(sub)) return true;
    const raw = sub.cancel_at;
    if (raw == null || raw === '') return false;
    try {
      const d = new Date(typeof raw === 'number' ? raw * 1000 : String(raw));
      if (Number.isNaN(d.getTime())) return false;
      return d.getTime() > Date.now();
    } catch {
      return false;
    }
  }

  /**
   * Nadal opłacony dostęp (w tym do końca okresu po rezygnacji). Nie opiera się wyłącznie na polu `plan`.
   */
  function hasPaidSubscriptionAccess(sub) {
    if (!sub || typeof sub !== 'object') return false;
    if (subscriptionStripeStatusTerminal(sub)) return false;
    const st = subscriptionStripeStatus(sub);
    const p = normalizePlan(sub.plan);
    const paidPlan = p === 'tier0' || p === 'tier1' || p === 'tier2';
    const sid =
      typeof sub.stripe_subscription_id === 'string' ? sub.stripe_subscription_id.trim() : '';
    const stripeLive =
      !!sid &&
      (st === 'active' || st === 'trialing' || st === 'past_due' || st === 'unpaid');
    if (paidPlan && sub.payment_completed === true) return true;
    if (stripeLive && (st === 'active' || st === 'trialing')) return true;
    return false;
  }

  /**
   * Subskrypcja nadal rozliczona (active/trialing), ale użytkownik zgłosił rezygnację — dostęp do `current_period_end`.
   */
  function isSubscriptionCanceledButValid(sub) {
    if (!sub || typeof sub !== 'object') return false;
    const st = subscriptionStripeStatus(sub);
    if (st !== 'active' && st !== 'trialing') return false;
    return subscriptionScheduledToCancel(sub);
  }

  /** Data końca bieżącego okresu rozliczeniowego (ISO / timestamp z Stripe) — do UI. */
  function formatSubscriptionPeriodEndPl(raw) {
    if (raw == null || raw === '') return '—';
    try {
      const d = new Date(typeof raw === 'number' ? raw * 1000 : String(raw));
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('pl-PL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return '—';
    }
  }

  window.DFOPS_planAllowsCustomDomain = planAllowsCustomDomain;
  window.DFOPS_planShowsWatermark = planShowsWatermark;
  window.DFOPS_planDisplayName = planDisplayName;
  window.DFOPS_subscriptionDisplayName = subscriptionDisplayName;
  window.DFOPS_planCapabilitiesSummary = planCapabilitiesSummary;
  window.DFOPS_subscriptionCancelAtPeriodEndTrue = subscriptionCancelAtPeriodEndTrue;
  window.DFOPS_subscriptionScheduledToCancel = subscriptionScheduledToCancel;
  window.DFOPS_hasPaidSubscriptionAccess = hasPaidSubscriptionAccess;
  window.DFOPS_subscriptionStripeStatusTerminal = subscriptionStripeStatusTerminal;
  window.DFOPS_isSubscriptionCanceledButValid = isSubscriptionCanceledButValid;
  window.DFOPS_formatSubscriptionPeriodEndPl = formatSubscriptionPeriodEndPl;
})();
