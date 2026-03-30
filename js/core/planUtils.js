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
    if (p === 'trial') return 'Trial (14 dni)';
    if (p === 'tier0') return 'Starter (Tier 0)';
    if (p === 'tier1') return 'Pro (Tier 1)';
    if (p === 'tier_custom' || p === 'custom') return 'Custom';
    return p;
  }

  function planCapabilitiesSummary(plan) {
    const p = normalizePlan(plan);
    const domain = planAllowsCustomDomain(p) ? 'Własna domena: tak' : 'Własna domena: nie (dostępna od Pro)';
    const wm = planShowsWatermark(p) ? 'Znak wodny: widoczny' : 'Znak wodny: wyłączony';
    return `${domain} · ${wm}`;
  }

  window.DFOPS_planAllowsCustomDomain = planAllowsCustomDomain;
  window.DFOPS_planShowsWatermark = planShowsWatermark;
  window.DFOPS_planDisplayName = planDisplayName;
  window.DFOPS_planCapabilitiesSummary = planCapabilitiesSummary;
})();
