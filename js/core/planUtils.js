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
    if (p === 'trial') return 'Trial (14 dni) — jak Starter';
    if (p === 'tier0') return 'Starter — 19 zł netto / msc';
    if (p === 'tier1') return 'Pro — 49 zł netto / msc';
    if (p === 'tier2') return 'Premium — 99 zł netto / msc';
    if (p === 'tier_custom' || p === 'custom') return 'Custom / Concierge';
    return p;
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

  window.DFOPS_planAllowsCustomDomain = planAllowsCustomDomain;
  window.DFOPS_planShowsWatermark = planShowsWatermark;
  window.DFOPS_planDisplayName = planDisplayName;
  window.DFOPS_planCapabilitiesSummary = planCapabilitiesSummary;
})();
