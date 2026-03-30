;(function () {
  /**
   * Zapis jednego zdarzenia do Supabase (gdy ustawiono analyticsTable i jest klient).
   */
  async function persistSupabaseEvent(eventName) {
    const cfg = typeof window !== 'undefined' ? window.DFOPS_CONFIG : null;
    const table = cfg && typeof cfg.analyticsTable === 'string' ? cfg.analyticsTable.trim() : '';
    if (!table || typeof window.DFOPS_getSupabaseClient !== 'function') return;
    try {
      const sb = window.DFOPS_getSupabaseClient();
      const {
        data: { session },
      } = await sb.auth.getSession();
      const row = {
        user_id: session?.user?.id ?? null,
        event_name: String(eventName).slice(0, 2000),
      };
      const { error } = await sb.from(table).insert(row);
      if (error && typeof console !== 'undefined' && console.debug) {
        console.debug('[DFOPS analytics db]', error.message);
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[DFOPS analytics db]', e);
      }
    }
  }

  /**
   * Minimalne zdarzenia produktowe. Opcjonalnie: Supabase (analyticsTable) i/lub POST (analyticsEndpoint).
   */
  function trackEvent(name, props) {
    const payload = {
      name,
      props: props || {},
      ts: new Date().toISOString(),
      path: typeof window !== 'undefined' ? window.location.pathname : '',
    };
    try {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[DFOPS analytics]', payload);
      }
    } catch (_) {}

    void persistSupabaseEvent(name);

    const cfg = typeof window !== 'undefined' ? window.DFOPS_CONFIG : null;
    const url = cfg && cfg.analyticsEndpoint;
    if (!url || typeof fetch !== 'function') return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  window.DFOPS_trackEvent = trackEvent;
})();
