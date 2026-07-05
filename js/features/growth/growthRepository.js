// Silnik Wzrostu (G2/G3) — adapter DB. Warstwa: Supabase + config, BEZ Alpine i BEZ reguł UI
// (patrz docs/GROWTH_AUTOPILOT_ARCHITECTURE.md §14.2). Wołane wyłącznie z growthPanel.js.
;(function () {
  function resolveClient(explicitClient) {
    if (explicitClient) return explicitClient;
    return typeof window.DFOPS_getSupabaseClient === 'function' ? window.DFOPS_getSupabaseClient() : null;
  }

  function debugLog(scope, err) {
    if (typeof console !== 'undefined' && console.debug) console.debug(`[DFOPS growthRepository] ${scope}`, err);
  }

  /** `growth_benchmarks` dla motywu → { metric_key: value }. */
  async function fetchBenchmarks(theme, supabaseClient) {
    const sb = resolveClient(supabaseClient);
    const themeId = typeof theme === 'string' ? theme.trim() : '';
    if (!sb || !themeId) return {};
    try {
      const { data, error } = await sb
        .from('growth_benchmarks')
        .select('metric_key, value, sample_size')
        .eq('theme', themeId);
      if (error || !Array.isArray(data)) {
        if (error) debugLog('fetchBenchmarks', error);
        return {};
      }
      const out = {};
      for (const row of data) {
        if (row && typeof row.metric_key === 'string') out[row.metric_key] = Number(row.value);
      }
      return out;
    } catch (e) {
      debugLog('fetchBenchmarks', e);
      return {};
    }
  }

  /** RPC get_page_growth_stats — liczniki konwersji (event_name → count) w oknie `days`. */
  async function fetchWeekStats(pageId, days, supabaseClient) {
    const sb = resolveClient(supabaseClient);
    if (!sb || !pageId) return {};
    try {
      const { data, error } = await sb.rpc('get_page_growth_stats', {
        p_page_id: pageId,
        p_days: Number(days) > 0 ? Number(days) : 7,
      });
      if (error || !data || typeof data !== 'object') {
        if (error) debugLog('fetchWeekStats', error);
        return {};
      }
      return { ...data };
    } catch (e) {
      debugLog('fetchWeekStats', e);
      return {};
    }
  }

  /**
   * RPC get_page_stats_range — total + unique per event_name w oknie [fromISO, toISO).
   * `fromISO` / `toISO` = ISO string albo null (brak ograniczenia = all-time / do teraz).
   * Zwraca { event_name: { total, unique } }.
   */
  async function fetchStatsRange(pageId, fromISO, toISO, supabaseClient) {
    const sb = resolveClient(supabaseClient);
    if (!sb || !pageId) return {};
    try {
      const { data, error } = await sb.rpc('get_page_stats_range', {
        p_page_id: pageId,
        p_from: fromISO || null,
        p_to: toISO || null,
      });
      if (error || !data || typeof data !== 'object') {
        if (error) debugLog('fetchStatsRange', error);
        return {};
      }
      return { ...data };
    } catch (e) {
      debugLog('fetchStatsRange', e);
      return {};
    }
  }

  /** Wiek strony w dniach (`pages.created_at`) — dla reguł typu `low_phone_clicks`. */
  async function fetchPageAgeDays(pageId, supabaseClient) {
    const sb = resolveClient(supabaseClient);
    if (!sb || !pageId) return 0;
    try {
      const { data, error } = await sb.from('pages').select('created_at').eq('id', pageId).maybeSingle();
      if (error || !data || !data.created_at) return 0;
      const createdMs = new Date(data.created_at).getTime();
      if (!Number.isFinite(createdMs)) return 0;
      return Math.max(0, Math.floor((Date.now() - createdMs) / 86400000));
    } catch (e) {
      debugLog('fetchPageAgeDays', e);
      return 0;
    }
  }

  /** Jedno wywołanie z growthPanel.js — benchmarki + statystyki tygodnia + wiek strony. */
  async function loadGrowthData(opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const { theme, pageId, supabaseClient, days } = options;
    const [benchmarks, weekStatsRaw, pageAgeDays] = await Promise.all([
      fetchBenchmarks(theme, supabaseClient),
      fetchWeekStats(pageId, days, supabaseClient),
      fetchPageAgeDays(pageId, supabaseClient),
    ]);
    return {
      benchmarks,
      weekStats: { ...weekStatsRaw, page_age_days: pageAgeDays },
    };
  }

  window.DFOPS_growthRepository = {
    fetchBenchmarks,
    fetchWeekStats,
    fetchStatsRange,
    fetchPageAgeDays,
    loadGrowthData,
  };
})();
