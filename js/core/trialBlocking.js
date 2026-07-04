/**
 * Wspólna logika blokady publicznej strony (trial 14 dni, billing_failed, trial_blocked_at).
 * Zsynchronizowana z public.expire_trial_pages() — migracja 20260611120000.
 */
;(function () {
  const MS_PER_DAY = 86400000;
  const TRIAL_PUBLIC_BLOCK_AFTER_DAYS = 14;
  const BILLING_FAILED_BLOCK_AFTER_DAYS = 14;

  /**
   * Czy ukryć treść strony publicznej (bez czekania na cron ustawiający trial_blocked_at).
   * @param {object|null|undefined} page — wiersz pages (slug, content, billing_plan, trial_blocked_at, billing_failed_at)
   */
  function shouldBlockPublicPageView(page) {
    if (!page || typeof page !== 'object') return true;
    if (page.content?.pl?.settings?.is_demo_catalog === true) return false;
    const billingPlan = String(page.billing_plan || '').trim() || 'trial';
    if (billingPlan === 'tier0' || billingPlan === 'tier1' || billingPlan === 'tier2') {
      return false;
    }
    if (page.trial_blocked_at) return true;
    const bf = page.billing_failed_at;
    if (bf) {
      const bt = new Date(bf).getTime();
      if (Number.isFinite(bt) && Date.now() - bt >= BILLING_FAILED_BLOCK_AFTER_DAYS * MS_PER_DAY) {
        return true;
      }
    }
    const sub = page.content?.pl?.settings?.subscription;
    if (!sub || typeof sub !== 'object') return true;
    const ts = sub.trial_started_at;
    if (ts == null || String(ts).trim() === '') return true;
    const start = new Date(ts).getTime();
    if (!Number.isFinite(start)) return true;
    if (Date.now() - start < TRIAL_PUBLIC_BLOCK_AFTER_DAYS * MS_PER_DAY) return false;
    return true;
  }

  window.DFOPS_shouldBlockPublicPageView = shouldBlockPublicPageView;
  window.DFOPS_TRIAL_PUBLIC_BLOCK_AFTER_DAYS = TRIAL_PUBLIC_BLOCK_AFTER_DAYS;
})();
